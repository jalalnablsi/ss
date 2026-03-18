// app/api/sync/route.ts
import { NextResponse } from 'next/server';
import { queryD1, executeD1 } from '@/lib/db';
import { validateTelegramWebAppData, parseInitData } from '@/lib/telegram';

// --- نظام Rate Limiting متقدم (In-Memory) ---
interface RateLimitInfo {
  count: number;
  resetTime: number;
  tapsInWindow: number;
  lastTapTime: number;
  suspiciousCount: number;
}

const rateLimits = new Map<string, RateLimitInfo>();

function checkRateLimit(telegramId: string): { allowed: boolean; reason?: string } {
  const now = Date.now();
  const windowMs = 60000; // دقيقة واحدة
  const maxRequests = 30; // 30 طلب في الدقيقة
  const maxTapsPerWindow = 500; // 500 ضغطة في الدقيقة
  const minTapInterval = 50; // 50ms بين الضغطات

  const current = rateLimits.get(telegramId) || {
    count: 0,
    resetTime: now + windowMs,
    tapsInWindow: 0,
    lastTapTime: 0,
    suspiciousCount: 0
  };

  // إعادة تعيين إذا انتهت النافذة
  if (now > current.resetTime) {
    current.count = 1;
    current.tapsInWindow = 0;
    current.resetTime = now + windowMs;
    current.suspiciousCount = 0;
    rateLimits.set(telegramId, current);
    return { allowed: true };
  }

  // فحص عدد الطلبات
  if (current.count >= maxRequests) {
    return { allowed: false, reason: 'rate_limit_exceeded' };
  }

  // فحص عدد الضغطات
  if (current.tapsInWindow >= maxTapsPerWindow) {
    return { allowed: false, reason: 'tap_limit_exceeded' };
  }

  // فحص الفاصل الزمني بين الضغطات (Anti-Bot)
  if (current.lastTapTime > 0 && now - current.lastTapTime < minTapInterval) {
    current.suspiciousCount++;
    if (current.suspiciousCount > 10) {
      return { allowed: false, reason: 'bot_pattern_detected' };
    }
  }

  current.count++;
  current.lastTapTime = now;
  rateLimits.set(telegramId, current);

  return { allowed: true };
}

// --- Anti-Cheat: تحليل أنماط الضغط ---
interface TapAnalysis {
  isValid: boolean;
  acceptedTaps: number;
  botScore: number;
  reason?: string;
}

function analyzeTaps(taps: any[], userEnergy: number, userTotalTaps: number): TapAnalysis {
  if (!taps || !Array.isArray(taps) || taps.length === 0) {
    return { isValid: true, acceptedTaps: 0, botScore: 0 };
  }

  // 1. فحص العدد
  if (taps.length > 100) {
    return { isValid: false, acceptedTaps: 0, botScore: 100, reason: 'batch_too_large' };
  }

  // 2. فحص الطاقة
  const acceptedTaps = Math.min(taps.length, userEnergy);

  // 3. تحليل التوقيتات (Bot Detection)
  let botScore = 0;
  
  if (taps.length >= 5) {
    const timestamps = taps.map(t => t.timestamp).filter(Boolean);
    
    if (timestamps.length >= 5) {
      // حساب التباين في التوقيتات
      const intervals = [];
      for (let i = 1; i < timestamps.length; i++) {
        intervals.push(timestamps[i] - timestamps[i-1]);
      }

      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const variance = intervals.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) / intervals.length;
      
      // البوتات: variance منخفض جداً (< 50)
      if (variance < 50) {
        botScore += 50;
      }

      // فحص الأنماط المنتظمة
      const isRegular = intervals.every(interval => Math.abs(interval - avg) < 10);
      if (isRegular && taps.length > 10) {
        botScore += 30;
      }
    }

    // فحص الإحداثيات (هل كلها نفس النقطة؟)
    const uniquePositions = new Set(taps.map(t => `${t.clientX},${t.clientY}`));
    if (uniquePositions.size === 1 && taps.length > 10) {
      botScore += 40; // بوت: نفس المكان دائماً
    }
  }

  // 4. فحص السرعة (هل هو أسرع من الإنسان؟)
  if (taps.length > 20) {
    const timeSpan = taps[taps.length - 1].timestamp - taps[0].timestamp;
    const tapsPerSecond = taps.length / (timeSpan / 1000);
    
    if (tapsPerSecond > 15) { // الإنسان max 10-12 ضغطة/ثانية
      botScore += 60;
    }
  }

  return {
    isValid: botScore < 100, // إذا كان score أقل من 100، نعتبره مقبول
    acceptedTaps: botScore >= 100 ? 0 : acceptedTaps,
    botScore,
    reason: botScore >= 100 ? 'bot_detected' : undefined
  };
}

// --- Main Handler ---
export async function POST(req: Request) {
  const requestId = crypto.randomUUID().slice(0, 8);
  const startTime = performance.now();

  try {
    const body = await req.json();
    const { initData, taps, adWatchedType, clientTime } = body;

    // 1. التحقق من صحة البيانات
    if (!initData) {
      return NextResponse.json(
        { error: 'Missing initData' },
        { status: 400 }
      );
    }

    // 2. التحقق من Telegram
    const isValid = await validateTelegramWebAppData(initData);
    if (!isValid) {
      console.error(`[${requestId}] Invalid signature`);
      return NextResponse.json(
        { error: 'Access Denied' },
        { status: 403 }
      );
    }

    // 3. استخراج بيانات المستخدم
    const tgUser = parseInitData(initData);
    if (!tgUser?.id) {
      return NextResponse.json(
        { error: 'No user data' },
        { status: 400 }
      );
    }

    const telegramId = tgUser.id.toString();

    // 4. Rate Limiting
    const rateCheck = checkRateLimit(telegramId);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', reason: rateCheck.reason },
        { status: 429 }
      );
    }

    // 5. جلب المستخدم من D1 (مع التخزين المؤقت)
    const users = await queryD1(
      'SELECT * FROM users WHERE telegram_id = ?',
      [telegramId]
    );

    const user = users[0];
    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    const now = Date.now();
    const serverTime = now;
    const timeDiff = clientTime ? Math.abs(serverTime - clientTime) : 0;
    
    // تحذير إذا كان توقيت العميل غير متزامن (قد يكون محاولة غش)
    if (timeDiff > 300000) { // 5 دقائق فرق
      console.warn(`[${requestId}] Time desync detected: ${timeDiff}ms`);
    }

    // 6. حساب استعادة الطاقة
    const timePassedSec = Math.floor((serverTime - user.last_update_time) / 1000);
    const regenRate = user.max_energy / 1800; // 30 دقيقة
    const recoveredEnergy = Math.floor(timePassedSec * regenRate);
    const currentEnergy = Math.min(user.max_energy, user.energy + recoveredEnergy);

    // 7. معالجة الضغطات مع Anti-Cheat
    let finalCoins = user.coins;
    let finalChallengeCoins = user.challenge_coins || 0;
    let finalEnergy = currentEnergy;
    let finalTotalTaps = user.total_taps;
    let tapsProcessed = 0;
    let botDetected = false;

    if (taps && taps.length > 0) {
      const analysis = analyzeTaps(taps, currentEnergy, user.total_taps);

      if (!analysis.isValid) {
        console.warn(`[${requestId}] Bot detected: score=${analysis.botScore}, reason=${analysis.reason}`);
        botDetected = true;
        
        // لا نعاقب المستخدم لكن نسجل المخالفة
        if (analysis.botScore > 150) {
          // مخالفة شديدة - نرفض الضغطات
          return NextResponse.json({
            error: 'Suspicious activity detected',
            code: 'BOT_DETECTED'
          }, { status: 403 });
        }
      }

      tapsProcessed = analysis.acceptedTaps;

      if (tapsProcessed > 0) {
        // حساب المضاعف
        const now = Date.now();
        const isMultiplierActive = user.tap_multiplier_end_time > now;
        const multiplier = isMultiplierActive ? user.tap_multiplier : 1;

        // تجميع المكافآت
        let totalEarned = 0;
        for (let i = 0; i < tapsProcessed; i++) {
          totalEarned += multiplier;
        }

        finalCoins += totalEarned;
        finalChallengeCoins += totalEarned;
        finalEnergy = Math.max(0, currentEnergy - tapsProcessed);
        finalTotalTaps += tapsProcessed;

        // تحديث عداد الضغطات في Rate Limiter
        const rateInfo = rateLimits.get(telegramId);
        if (rateInfo) {
          rateInfo.tapsInWindow += tapsProcessed;
        }
      }
    }

    // 8. معالجة مكافآت الإعلانات
    let newMultiplier = user.tap_multiplier;
    let newMultiplierEnd = user.tap_multiplier_end_time;
    let newBotEnd = user.auto_bot_active_until;
    let newAdsWatchedToday = user.ads_watched_today;
    let newLastAdWatchDate = user.last_ad_watch_date;

    // إعادة تعيين الإعلانات اليومية إذا كان يوم جديد
    const todayStr = new Date(serverTime).toISOString().split('T')[0];
    if (newLastAdWatchDate !== todayStr) {
      newAdsWatchedToday = 0;
      newLastAdWatchDate = todayStr;
    }

    if (adWatchedType) {
      // فحص الحدود
      if (newAdsWatchedToday >= 30) {
        return NextResponse.json(
          { error: 'Daily ad limit reached' },
          { status: 429 }
        );
      }

      // فحص الحد الساعي
      const oneHourAgo = new Date(serverTime - 3600000).toISOString();
      const recentAds = await queryD1(
        `SELECT COUNT(*) as count FROM ad_watches 
         WHERE telegram_id = ? AND watched_at >= ?`,
        [telegramId, oneHourAgo]
      );

      if ((recentAds[0]?.count || 0) >= 5) {
        return NextResponse.json(
          { error: 'Hourly ad limit reached' },
          { status: 429 }
        );
      }

      // تسجيل مشاهدة الإعلان
      await executeD1(
        `INSERT INTO ad_watches (id, telegram_id, watched_at) 
         VALUES (?, ?, ?)`,
        [crypto.randomUUID(), telegramId, new Date(serverTime).toISOString()]
      );

      newAdsWatchedToday++;
      finalCoins += 1000;
      finalChallengeCoins += 1000;

      // تطبيق المكافآت
      switch (adWatchedType) {
        case 'multiplier':
          newMultiplier = 2;
          newMultiplierEnd = serverTime + 300000; // 5 دقائق
          break;
        case 'energy':
          finalEnergy = user.max_energy;
          break;
        case 'bot':
          newBotEnd = serverTime + 21600000; // 6 ساعات
          break;
      }
    }

    // 9. التحقق من مكافأة الإحالة (500 ضغطة)
    let referralRewarded = false;
    if (finalTotalTaps >= 500 && user.total_taps < 500 && user.referred_by) {
      const result = await executeD1(
        `UPDATE users 
         SET coins = coins + 1500,
             challenge_coins = COALESCE(challenge_coins, 0) + 1500,
             referrals_activated = referrals_activated + 1,
             referral_coins_earned = COALESCE(referral_coins_earned, 0) + 1500
         WHERE telegram_id = ?`,
        [user.referred_by]
      );

      if (result.meta?.changes > 0) {
        referralRewarded = true;
      }
    }

    // 10. تحديث قاعدة البيانات (تحديث واحد)
    await executeD1(
      `UPDATE users SET
        coins = ?,
        challenge_coins = ?,
        energy = ?,
        total_taps = ?,
        tap_multiplier = ?,
        tap_multiplier_end_time = ?,
        auto_bot_active_until = ?,
        ads_watched_today = ?,
        last_ad_watch_date = ?,
        last_update_time = ?
      WHERE telegram_id = ?`,
      [
        finalCoins,
        finalChallengeCoins,
        finalEnergy,
        finalTotalTaps,
        newMultiplier,
        newMultiplierEnd,
        newBotEnd,
        newAdsWatchedToday,
        newLastAdWatchDate,
        serverTime,
        telegramId
      ]
    );

    // 11. جلب البيانات المحدثة
    const updatedUsers = await queryD1(
      'SELECT * FROM users WHERE telegram_id = ?',
      [telegramId]
    );
    const updatedUser = updatedUsers[0];

    const duration = performance.now() - startTime;
    console.log(`[${requestId}] Sync: ${tapsProcessed} taps, ${duration.toFixed(0)}ms`);

    // 12. الرد
    return NextResponse.json({
      success: true,
      user: {
        id: updatedUser.id,
        telegram_id: updatedUser.telegram_id,
        coins: updatedUser.coins,
        challenge_coins: updatedUser.challenge_coins,
        energy: updatedUser.energy,
        max_energy: updatedUser.max_energy,
        total_taps: updatedUser.total_taps,
        tap_multiplier: updatedUser.tap_multiplier,
        tap_multiplier_end_time: updatedUser.tap_multiplier_end_time,
        auto_bot_active_until: updatedUser.auto_bot_active_until,
        ads_watched_today: updatedUser.ads_watched_today,
        last_ad_watch_date: updatedUser.last_ad_watch_date,
        wallet_connected: Boolean(updatedUser.wallet_connected)
      },
      serverTime,
      meta: {
        tapsProcessed,
        coinsEarned: finalCoins - user.coins,
        energyUsed: tapsProcessed,
        botDetected,
        referralRewarded,
        processingTimeMs: Math.round(duration)
      }
    });

  } catch (error) {
    console.error(`[${requestId}] Error:`, error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ status: 'ok' });
}
