// app/api/auth/route.ts
import { NextResponse } from 'next/server';
import { queryD1, executeD1 } from '@/lib/db';

// ============================================================================
// 🛡️ أنواع البيانات (Type Safety)
// ============================================================================

interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

interface UserRecord {
  id: string;
  telegram_id: string;
  first_name: string;
  last_name: string | null;
  username: string | null;
  coins: number;
  challenge_coins: number;
  energy: number;
  max_energy: number;
  last_update_time: number;
  last_ad_watch_date: string;
  ads_watched_today: number;
  referrals_count: number;
  referred_by: string | null;
  completed_tasks: string; // JSON
  auto_bot_active_until: number;
  wallet_connected: number; // 0 or 1
}

interface AuthResponse {
  success: boolean;
  user?: {
    id: string;
    telegramId: string;
    firstName: string;
    lastName: string | null;
    username: string | null;
    coins: number;
    challengeCoins: number;
    energy: number;
    maxEnergy: number;
    referralsCount: number;
    completedTasks: string[];
    walletConnected: boolean;
    autoBotActive: boolean;
    autoBotTimeLeft: number;
  };
  serverTime: number;
  error?: string;
  code?: string;
}

// ============================================================================
// 🔐 خدمة التحقق من Telegram (مع التخزين المؤقت)
// ============================================================================

class TelegramAuthService {
  private static readonly WEB_APP_DATA = 'WebAppData';
  
  // تخزين مؤقت للمفاتيح (Cache) - يقلل العمليات الحسابية
  private static secretKeyCache: Map<string, ArrayBuffer> = new Map();

  static async validate(initData: string, botToken?: string): Promise<{
    valid: boolean;
    user?: TelegramUser;
    error?: string;
  }> {
    // وضع التطوير: قبول مؤقت بدون توكن
    if (!botToken) {
      console.warn('[AUTH] ⚠️ Development mode: No bot token provided');
      const user = this.extractUser(initData);
      return user ? { valid: true, user } : { valid: false, error: 'No user data' };
    }

    try {
      const urlParams = new URLSearchParams(initData);
      const hash = urlParams.get('hash');
      
      if (!hash) {
        return { valid: false, error: 'Missing hash parameter' };
      }

      // استخراج المستخدم قبل حذف البيانات
      const userStr = urlParams.get('user');
      const user = userStr ? JSON.parse(userStr) as TelegramUser : undefined;

      // إنشاء سلسلة التحقق
      urlParams.delete('hash');
      const dataCheckString = this.buildDataCheckString(urlParams);

      // التحقق من التوقيع
      const isValid = await this.verifySignature(botToken, dataCheckString, hash);
      
      if (!isValid) {
        console.error('[AUTH] ❌ Invalid signature', {
          hashReceived: hash.slice(0, 10) + '...',
          dataLength: dataCheckString.length,
        });
        return { valid: false, error: 'Invalid signature' };
      }

      return { valid: true, user };
    } catch (error) {
      console.error('[AUTH] 💥 Validation error:', error);
      return { valid: false, error: 'Validation failed' };
    }
  }

  private static buildDataCheckString(params: URLSearchParams): string {
    // ترتيب أبجدي إلزامي حسب مواصفات Telegram
    const keys = Array.from(params.keys()).sort();
    return keys.map(key => `${key}=${params.get(key)}`).join('\n');
  }

  private static async verifySignature(
    botToken: string, 
    data: string, 
    hash: string
  ): Promise<boolean> {
    // استخدام التخزين المؤقت للمفتاح السري
    let secretKey = this.secretKeyCache.get(botToken);
    
    if (!secretKey) {
      secretKey = await this.hmacSha256(this.WEB_APP_DATA, botToken);
      this.secretKeyCache.set(botToken, secretKey);
    }

    const calculatedHash = await this.hmacSha256Hex(secretKey, data);
    return calculatedHash === hash;
  }

  private static async hmacSha256(
    key: string | ArrayBuffer, 
    data: string
  ): Promise<ArrayBuffer> {
    const encoder = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      typeof key === 'string' ? encoder.encode(key) : key,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
  }

  private static async hmacSha256Hex(key: ArrayBuffer, data: string): Promise<string> {
    const buffer = await this.hmacSha256(key, data);
    return Array.from(new Uint8Array(buffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private static extractUser(initData: string): TelegramUser | undefined {
    try {
      const params = new URLSearchParams(initData);
      const userStr = params.get('user');
      return userStr ? JSON.parse(userStr) : undefined;
    } catch {
      return undefined;
    }
  }
}

// ============================================================================
// 🗄️ خدمة قاعدة البيانات (مع تحسينات الأداء)
// ============================================================================

class UserService {
  private static readonly ENERGY_REGEN_SECONDS = 1800; // 30 دقيقة للتجديد الكامل
  private static readonly AUTO_BOT_RATE = 0.5; // عملة/ثانية

  /**
   * الحصول على المستخدم مع تحديث ذكي للطاقة
   * يقلل الاستعلامات إلى قاعدة البيانات
   */
  static async getOrCreateUser(
    tgUser: TelegramUser,
    referralCode: string | null,
    now: number
  ): Promise<UserRecord> {
    const telegramId = tgUser.id.toString();
    
    // محاولة واحدة للحصول على المستخدم
    let user = await this.fetchUser(telegramId);

    if (!user) {
      return this.createUser(tgUser, referralCode, now);
    }

    // تحديث ذكي: فقط إذا تغيرت البيانات فعلياً
    const updates = this.calculateUpdates(user, now);
    
    if (updates.hasChanges) {
      await this.updateUser(telegramId, updates.data);
      // إعادة الجلب مرة واحدة فقط
      user = await this.fetchUser(telegramId);
    }

    return user!;
  }

  private static async fetchUser(telegramId: string): Promise<UserRecord | null> {
    const users = await queryD1<UserRecord>(
      'SELECT * FROM users WHERE telegram_id = ? LIMIT 1',
      [telegramId]
    );
    return users[0] || null;
  }

  private static calculateUpdates(user: UserRecord, now: number): {
    hasChanges: boolean;
    data: Partial<UserRecord>;
  } {
    const updates: Partial<UserRecord> = {};
    let hasChanges = false;

    // 1. تجديد الطاقة
    const timePassedSec = Math.floor((now - user.last_update_time) / 1000);
    
    if (timePassedSec > 0 && user.energy < user.max_energy) {
      const regenRate = user.max_energy / this.ENERGY_REGEN_SECONDS;
      const energyToAdd = Math.floor(timePassedSec * regenRate);
      const newEnergy = Math.min(user.max_energy, user.energy + energyToAdd);
      
      if (newEnergy !== user.energy) {
        updates.energy = newEnergy;
        hasChanges = true;
      }
    }

    // 2. أرباح الـ Auto-Bot (حساب فعّال)
    if (user.auto_bot_active_until > user.last_update_time) {
      const activeEndTime = Math.min(now, user.auto_bot_active_until);
      const activeSeconds = Math.floor((activeEndTime - user.last_update_time) / 1000);
      
      if (activeSeconds > 0) {
        const earned = Math.floor(activeSeconds * this.AUTO_BOT_RATE);
        updates.coins = (user.coins || 0) + earned;
        updates.challenge_coins = (user.challenge_coins || 0) + earned;
        hasChanges = true;
      }
    }

    // 3. إعادة تعيين الإعلانات اليومية
    const today = new Date(now).toISOString().split('T')[0];
    if (user.last_ad_watch_date !== today) {
      updates.last_ad_watch_date = today;
      updates.ads_watched_today = 0;
      hasChanges = true;
    }

    // 4. تحديث الوقت فقط إذا كان هناك تغييرات
    if (hasChanges) {
      updates.last_update_time = now;
    }

    return { hasChanges, data: updates };
  }

  private static async updateUser(
    telegramId: string, 
    updates: Partial<UserRecord>
  ): Promise<void> {
    const entries = Object.entries(updates);
    if (entries.length === 0) return;

    const setClause = entries.map(([key]) => `${key} = ?`).join(', ');
    const values = entries.map(([, value]) => value);

    await executeD1(
      `UPDATE users SET ${setClause} WHERE telegram_id = ?`,
      [...values, telegramId]
    );
  }

  private static async createUser(
    tgUser: TelegramUser,
    referralCode: string | null,
    now: number
  ): Promise<UserRecord> {
    const id = crypto.randomUUID();
    const telegramId = tgUser.id.toString();
    const today = new Date(now).toISOString().split('T')[0];

    // إدراج فعّال باستخدام INSERT OR IGNORE للأمان
    await executeD1(
      `INSERT INTO users (
        id, telegram_id, first_name, last_name, username,
        last_update_time, referred_by, completed_tasks,
        last_ad_watch_date, challenge_coins, energy, max_energy,
        coins, referrals_count, auto_bot_active_until, wallet_connected
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        username = excluded.username,
        last_update_time = excluded.last_update_time`,
      [
        id, telegramId, tgUser.first_name || '', tgUser.last_name || null,
        tgUser.username || null, now, referralCode || null, '[]',
        today, 0, 500, 500, 0, 0, 0, 0
      ]
    );

    // معالجة الإحالة في عملية منفصلة (لا تؤثر على التسجيل)
    if (referralCode && referralCode !== telegramId) {
      await this.processReferral(referralCode).catch(err => 
        console.error('[REFERRAL] Failed:', err)
      );
    }

    const user = await this.fetchUser(telegramId);
    if (!user) throw new Error('Failed to create user');
    
    return user;
  }

  private static async processReferral(referralCode: string): Promise<void> {
    await executeD1(
      `UPDATE users SET referrals_count = referrals_count + 1 
       WHERE telegram_id = ? AND referrals_count < 1000`,
      [referralCode]
    );
  }
}

// ============================================================================
// 🎯 معالج الطلب الرئيسي (Main Handler)
// ============================================================================

export async function POST(req: Request): Promise<Response> {
  const startTime = performance.now();
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    // 1. التحقق من المحتوى
    const contentType = req.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      return jsonResponse({ 
        success: false, 
        error: 'Content-Type must be application/json',
        code: 'INVALID_CONTENT_TYPE'
      }, 400);
    }

    // 2. قراءة الجسم
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return jsonResponse({ 
        success: false, 
        error: 'Invalid JSON body',
        code: 'INVALID_JSON'
      }, 400);
    }

    const { initData, referralCode } = body;

    if (!initData || typeof initData !== 'string') {
      return jsonResponse({ 
        success: false, 
        error: 'Missing or invalid initData',
        code: 'MISSING_INIT_DATA'
      }, 400);
    }

    // 3. التحقق من Telegram
    const validation = await TelegramAuthService.validate(
      initData, 
      process.env.TELEGRAM_BOT_TOKEN
    );

    if (!validation.valid) {
      console.error(`[${requestId}] Auth failed:`, validation.error);
      return jsonResponse({ 
        success: false, 
        error: validation.error || 'Authentication failed',
        code: 'AUTH_FAILED'
      }, 403);
    }

    if (!validation.user) {
      return jsonResponse({ 
        success: false, 
        error: 'User data not found',
        code: 'NO_USER_DATA'
      }, 400);
    }

    // 4. معالجة المستخدم
    const now = Date.now();
    const userRecord = await UserService.getOrCreateUser(
      validation.user,
      referralCode || null,
      now
    );

    // 5. تنسيق الاستجابة
    const response: AuthResponse = {
      success: true,
      user: {
        id: userRecord.id,
        telegramId: userRecord.telegram_id,
        firstName: userRecord.first_name,
        lastName: userRecord.last_name,
        username: userRecord.username,
        coins: userRecord.coins,
        challengeCoins: userRecord.challenge_coins,
        energy: userRecord.energy,
        maxEnergy: userRecord.max_energy,
        referralsCount: userRecord.referrals_count,
        completedTasks: JSON.parse(userRecord.completed_tasks || '[]'),
        walletConnected: Boolean(userRecord.wallet_connected),
        autoBotActive: userRecord.auto_bot_active_until > now,
        autoBotTimeLeft: Math.max(0, userRecord.auto_bot_active_until - now),
      },
      serverTime: now,
    };

    // 6. تسجيل الأداء
    const duration = Math.round(performance.now() - startTime);
    console.log(`[${requestId}] ✅ Auth success for ${validation.user.id} in ${duration}ms`);

    return jsonResponse(response, 200);

  } catch (error) {
    console.error(`[${requestId}] 💥 Unexpected error:`, error);
    
    return jsonResponse({ 
      success: false, 
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    }, 500);
  }
}

// ============================================================================
// 🛠️ دوال مساعدة
// ============================================================================

function jsonResponse(data: object, status: number): Response {
  return NextResponse.json(data, { 
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    }
  });
}

