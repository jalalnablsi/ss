
import { NextResponse } from 'next/server';
import { queryD1, executeD1 } from '@/lib/db';

// --- دوال مساعدة للتشفير متوافقة مع Edge Runtime ---

async function hmacSha256(key: string | ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    typeof key === 'string' ? encoder.encode(key) : key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
}

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// --- دالة التحقق من بيانات تليجرام ---

async function validateTelegramWebAppData(initData: string): Promise<boolean> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.warn('TELEGRAM_BOT_TOKEN is missing. Skipping validation for development.');
    return false;
  }

  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    if (!hash) return false;

    urlParams.delete('hash');
    
    // ترتيب المفاتيح أبجدياً
    const keys = Array.from(urlParams.keys()).sort();
    let dataCheckString = '';
    for (const key of keys) {
      dataCheckString += `${key}=${urlParams.get(key)}\n`;
    }
    dataCheckString = dataCheckString.slice(0, -1);

    // تنفيذ التشفير باستخدام Web Crypto API
    const secretKeyBuffer = await hmacSha256('WebAppData', botToken);
    const calculatedHashBuffer = await hmacSha256(secretKeyBuffer, dataCheckString);
    const calculatedHash = bufferToHex(calculatedHashBuffer);

    return calculatedHash === hash;
  } catch (error) {
    console.error('Validation error:', error);
    return false;
  }
}

// --- دالة المعالجة الرئيسية ---

export async function POST(req: Request) {
  try {
    const { initData, referralCode } = await req.json();

    if (!initData) {
      return NextResponse.json({ error: 'Missing initData' }, { status: 400 });
    }

    // 1. التحقق من بيانات تليجرام (أصبحت async الآن)
    const isValid = await validateTelegramWebAppData(initData);
    
    if (!isValid && process.env.TELEGRAM_BOT_TOKEN) {
      return NextResponse.json({ error: 'Invalid Telegram data. Possible bot attack.' }, { status: 403 });
    }

    // تحليل بيانات المستخدم
    const urlParams = new URLSearchParams(initData);
    const userStr = urlParams.get('user');
    if (!userStr) {
      return NextResponse.json({ error: 'No user data found' }, { status: 400 });
    }

    const tgUser = JSON.parse(userStr);
    const telegramId = tgUser.id.toString();
    const now = Date.now();
    const today = new Date().toISOString().split('T')[0];

    // التأكد من وجود عمود عملات التحدي (Migration)
    try {
      await executeD1('ALTER TABLE users ADD COLUMN challenge_coins INTEGER DEFAULT 0');
    } catch (e) {
      // تجاهل إذا كان موجوداً مسبقاً
    }

    // 2. جلب المستخدم من قاعدة البيانات D1
    const users = await queryD1('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
    let user = users[0];

    // 3. إنشاء مستخدم جديد إذا لم يكن موجوداً
    if (!user) {
      const id = crypto.randomUUID(); // مدعوم عالمياً في Edge
      const completedTasks = JSON.stringify([]);
      
      await executeD1(`
        INSERT INTO users (
          id, telegram_id, first_name, last_name, username, 
          last_update_time, referred_by, completed_tasks, last_ad_watch_date, challenge_coins
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        id, telegramId, tgUser.first_name || '', tgUser.last_name || null, tgUser.username || null,
        now, referralCode || null, completedTasks, today, 0
      ]);

      if (referralCode && referralCode !== telegramId) {
        await executeD1('UPDATE users SET referrals_count = referrals_count + 1 WHERE telegram_id = ?', [referralCode]);
      }

      const newUsers = await queryD1('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
      user = newUsers[0];
    } else {
      // 4. تحديثات تلقائية للمستخدم الحالي
      let updates: Record<string, any> = {};
      let needsUpdate = false;

      if (user.last_ad_watch_date !== today) {
        updates.ads_watched_today = 0;
        updates.last_ad_watch_date = today;
        needsUpdate = true;
      }

      const timePassedSec = Math.floor((now - user.last_update_time) / 1000);

      // تجديد الطاقة
      if (user.energy < user.max_energy) {
        const energyToRecover = Math.floor(timePassedSec * (user.max_energy / 1800));
        const newEnergy = Math.min(user.max_energy, user.energy + energyToRecover);
        if (newEnergy !== user.energy) {
          updates.energy = newEnergy;
          needsUpdate = true;
        }
      }

      // أرباح الـ Auto-Bot
      if (user.auto_bot_active_until > user.last_update_time) {
        const botActiveTimeMs = Math.min(now, user.auto_bot_active_until) - user.last_update_time;
        const botActiveTimeSec = Math.floor(botActiveTimeMs / 1000);
        if (botActiveTimeSec > 0) {
          const earnedCoins = Math.floor(botActiveTimeSec * 0.5);
          updates.coins = (user.coins || 0) + earnedCoins;
          updates.challenge_coins = (user.challenge_coins || 0) + earnedCoins;
          needsUpdate = true;
        }
      }

      if (needsUpdate) {
        updates.last_update_time = now;
        const setClauses = Object.keys(updates).map(key => `${key} = ?`).join(', ');
        const values = [...Object.values(updates), telegramId];

        await executeD1(`UPDATE users SET ${setClauses} WHERE telegram_id = ?`, values);
        const updatedUsers = await queryD1('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
        user = updatedUsers[0];
      }
    }

    user.completed_tasks = JSON.parse(user.completed_tasks || '[]');
    user.wallet_connected = Boolean(user.wallet_connected);

    return NextResponse.json({ user, serverTime: now });
  } catch (error) {
    console.error('Auth API Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
