import { NextResponse } from 'next/server';
import { queryD1, executeD1 } from '@/lib/db';
import crypto from 'crypto';
import { 
  checkAdEligibility, 
  logAdWatch, 
  detectSuspiciousActivity 
} from '@/lib/adProtection';

function validateTelegramWebAppData(initData: string): boolean {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return false;

  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    if (!hash) return false;

    urlParams.delete('hash');
    const keys = Array.from(urlParams.keys()).sort();
    let dataCheckString = '';
    for (const key of keys) {
      dataCheckString += `${key}=${urlParams.get(key)}\n`;
    }
    dataCheckString = dataCheckString.slice(0, -1);

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    return calculatedHash === hash;
  } catch (error) {
    console.error('Validation error:', error);
    return false;
  }
}

function calculateEnergyRegen(user: any, now: number): number {
  const timePassedSec = (now - user.last_update_time) / 1000;
  if (timePassedSec <= 0) return user.energy;
  
  const regenRate = user.max_energy / 1800;
  const recoveredEnergy = timePassedSec * regenRate;
  return Math.min(user.max_energy, user.energy + recoveredEnergy);
}

function calculateBotEarnings(user: any, now: number): number {
  if (!user.auto_bot_active_until || user.auto_bot_active_until <= user.last_update_time) return 0;
  
  const activeEndTime = Math.min(now, user.auto_bot_active_until);
  const activeSeconds = (activeEndTime - user.last_update_time) / 1000;
  
  if (activeSeconds <= 0) return 0;
  
  return activeSeconds * 0.5;
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    const { initData, taps, adWatchedType } = await req.json();

    if (!initData) {
      return NextResponse.json({ error: 'Missing initData', code: 'MISSING_INIT_DATA' }, { status: 400 });
    }

    const isValid = validateTelegramWebAppData(initData);
    if (!isValid && process.env.TELEGRAM_BOT_TOKEN) {
      console.warn(`[${requestId}] Invalid Telegram signature`);
      return NextResponse.json({ error: 'Invalid Telegram data', code: 'INVALID_SIGNATURE' }, { status: 403 });
    }

    const urlParams = new URLSearchParams(initData);
    const userStr = urlParams.get('user');
    if (!userStr) {
      return NextResponse.json({ error: 'No user data found', code: 'NO_USER_DATA' }, { status: 400 });
    }
    
    const tgUser = JSON.parse(decodeURIComponent(userStr));
    const telegramId = tgUser.id.toString();
    const now = Date.now();
    const todayStr = new Date(now).toISOString().split('T')[0];

    // ✅ استخدام SELECT محدد بدلاً من SELECT *
    const users = await queryD1(
      `SELECT id, coins, challenge_coins, energy, max_energy, total_taps, 
              tap_multiplier, tap_multiplier_end_time, auto_bot_active_until,
              ads_watched_today, last_ad_watch_date, referrals_activated,
              last_update_time, wallet_connected, completed_tasks, referred_by
       FROM users WHERE telegram_id = ?`,
      [telegramId]
    );
    const user = users[0];

    if (!user) {
      return NextResponse.json({ error: 'User not found.', code: 'USER_NOT_FOUND' }, { status: 404 });
    }

    // ✅ فحص النشاط المشبوه فقط إذا كان هناك إعلان
    if (adWatchedType) {
      const suspiciousCheck = await detectSuspiciousActivity(telegramId);
      if (suspiciousCheck.isSuspicious) {
        console.warn(`[${requestId}] Suspicious activity detected for ${telegramId}: ${suspiciousCheck.reason}`);
        return NextResponse.json({ 
          error: 'Suspicious activity detected', 
          code: 'SUSPICIOUS_ACTIVITY',
          details: suspiciousCheck.reason 
        }, { status: 429 });
      }
    }

    let currentEnergy = calculateEnergyRegen(user, now);
    let botEarnings = calculateBotEarnings(user, now);
    
    let newCoins = user.coins + botEarnings;
    let newChallengeCoins = (user.challenge_coins || 0) + botEarnings;
    let newTotalTaps = user.total_taps;
    
    let newTapMultiplier = user.tap_multiplier;
    let newTapMultiplierEndTime = user.tap_multiplier_end_time;
    let newAutoBotActiveUntil = user.auto_bot_active_until;
    let newAdsWatchedToday = user.ads_watched_today;
    let newLastAdWatchDate = user.last_ad_watch_date;
    let newReferralsActivated = user.referrals_activated;

    let lastAdDateStr = '';
    if (newLastAdWatchDate) {
      lastAdDateStr = newLastAdWatchDate.includes('T') 
        ? newLastAdWatchDate.split('T')[0] 
        : new Date(parseInt(newLastAdWatchDate)).toISOString().split('T')[0];
    }
    
    if (lastAdDateStr !== todayStr) {
      newAdsWatchedToday = 0;
    }

    let adRewardApplied = false;
    let adProtectionResult = null;

    if (adWatchedType) {
      adProtectionResult = await checkAdEligibility(telegramId);
      
      if (!adProtectionResult.allowed) {
        return NextResponse.json({ 
          error: 'Ad not allowed', 
          code: adProtectionResult.reason,
          details: {
            remainingToday: adProtectionResult.remainingToday,
            remainingThisHour: adProtectionResult.remainingThisHour,
            waitSeconds: adProtectionResult.waitSeconds,
            nextAllowedAt: adProtectionResult.nextAllowedAt
          }
        }, { status: 429 });
      }

      await logAdWatch(
        telegramId, 
        adWatchedType, 
        1000,
        req.headers.get('x-forwarded-for') || undefined,
        req.headers.get('user-agent') || undefined
      );

      newAdsWatchedToday += 1;
      newLastAdWatchDate = new Date(now).toISOString();
      adRewardApplied = true;

      newCoins += 1000;
      newChallengeCoins += 1000;

      if (adWatchedType === 'multiplier') {
        newTapMultiplier = 4;
        newTapMultiplierEndTime = now + 5 * 60 * 1000;
      } else if (adWatchedType === 'energy') {
        currentEnergy = user.max_energy;
      } else if (adWatchedType === 'bot') {
        const currentTime = newAutoBotActiveUntil > now ? newAutoBotActiveUntil : now;
        newAutoBotActiveUntil = currentTime + 6 * 60 * 60 * 1000;
      }
    }

    let processedTapsCount = 0;
    
    // ✅ تحسين: معالجة Taps بشكل أكثر كفاءة
    if (taps && Array.isArray(taps) && taps.length > 0) {
      const timeDiffSec = (now - user.last_update_time) / 1000;
      const maxTapsAllowed = Math.floor(timeDiffSec * 20) + 20; // ✅ زيادة الحد قليلاً
      
      const tapsToProcess = Math.min(taps.length, maxTapsAllowed, 100); // ✅ حد أقصى 100 tap
      processedTapsCount = tapsToProcess;

      // ✅ حساب المجموع بدلاً من loop
      const totalTapValue = tapsToProcess * (newTapMultiplierEndTime > now ? newTapMultiplier : 1);
      
      const energyCost = Math.min(tapsToProcess, currentEnergy);
      currentEnergy -= energyCost;
      newTotalTaps += energyCost;
      newCoins += energyCost * (newTapMultiplierEndTime > now ? newTapMultiplier : 1);
      newChallengeCoins += energyCost * (newTapMultiplierEndTime > now ? newTapMultiplier : 1);
    }

    // Handle referrals
    if (newTotalTaps >= 500 && user.total_taps < 500 && user.referred_by) {
      try {
        // ✅ استخدام UPDATE واحد
        await executeD1(`
          UPDATE users 
          SET coins = coins + 1500, 
              challenge_coins = COALESCE(challenge_coins, 0) + 1500,
              referrals_activated = referrals_activated + 1, 
              referral_coins_earned = referral_coins_earned + 1500 
          WHERE telegram_id = ?
        `, [user.referred_by]);
        
        newReferralsActivated += 1;
      } catch (e) {
        console.error(`[${requestId}] Failed to process referral reward:`, e);
      }
    }

    // ✅ UPDATE واحد
    await executeD1(`
      UPDATE users SET 
        coins = ?, 
        challenge_coins = ?, 
        energy = ?, 
        total_taps = ?, 
        tap_multiplier = ?, 
        tap_multiplier_end_time = ?, 
        auto_bot_active_until = ?, 
        ads_watched_today = ?, 
        last_ad_watch_date = ?, 
        referrals_activated = ?,
        last_update_time = ?
      WHERE telegram_id = ?
    `, [
      newCoins, 
      newChallengeCoins, 
      currentEnergy, 
      newTotalTaps,
      newTapMultiplier, 
      newTapMultiplierEndTime, 
      newAutoBotActiveUntil, 
      newAdsWatchedToday, 
      newLastAdWatchDate, 
      newReferralsActivated,
      now, 
      telegramId
    ]);

    // ✅ الحصول على حالة الإعلانات المحدثة
    const updatedAdProtection = adWatchedType 
      ? await checkAdEligibility(telegramId)
      : adProtectionResult;

    return NextResponse.json({ 
      success: true, 
      user: {
        id: user.id,
        telegramId: telegramId,
        coins: newCoins,
        challengeCoins: newChallengeCoins,
        energy: currentEnergy,
        maxEnergy: user.max_energy,
        totalTaps: newTotalTaps,
        tapMultiplier: newTapMultiplier,
        tapMultiplierEndTime: newTapMultiplierEndTime,
        autoBotActiveUntil: newAutoBotActiveUntil,
        adsWatchedToday: newAdsWatchedToday,
        referralsActivated: newReferralsActivated,
        walletConnected: Boolean(user.wallet_connected),
        completedTasks: JSON.parse(user.completed_tasks || '[]')
      },
      serverTime: now,
      meta: {
        botEarnings,
        energyRecovered: currentEnergy - user.energy,
        processedTaps: processedTapsCount,
        adRewardApplied,
        adProtection: updatedAdProtection ? {
          remainingToday: updatedAdProtection.remainingToday,
          remainingThisHour: updatedAdProtection.remainingThisHour,
          nextAdInSeconds: updatedAdProtection.waitSeconds,
          isAllowed: updatedAdProtection.allowed,
          waitSeconds: updatedAdProtection.waitSeconds
        } : null
      }
    });

  } catch (error) {
    console.error(`[${requestId}] Sync API Error:`, error);
    return NextResponse.json({ 
      error: 'Internal Server Error', 
      details: error instanceof Error ? error.message : String(error) 
    }, { status: 500 });
  }
}
