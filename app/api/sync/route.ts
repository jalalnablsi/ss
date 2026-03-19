import { NextResponse } from 'next/server';
import { queryD1, executeD1 } from '@/lib/db';
import crypto from 'crypto';

// --- Helper: Validate Telegram Data ---
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

// --- Helper: Calculate Energy Regen ---
function calculateEnergyRegen(user: any, now: number): number {
  const timePassedSec = (now - user.last_update_time) / 1000;
  if (timePassedSec <= 0) return user.energy;
  
  const regenRate = user.max_energy / 1800; // Full energy in 30 mins
  const recoveredEnergy = timePassedSec * regenRate;
  return Math.min(user.max_energy, user.energy + recoveredEnergy);
}

// --- Helper: Calculate Bot Earnings ---
function calculateBotEarnings(user: any, now: number): number {
  if (!user.auto_bot_active_until || user.auto_bot_active_until <= user.last_update_time) return 0;
  
  const activeEndTime = Math.min(now, user.auto_bot_active_until);
  const activeSeconds = (activeEndTime - user.last_update_time) / 1000;
  
  if (activeSeconds <= 0) return 0;
  
  return activeSeconds * 0.5; // 0.5 coin per second
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    const { initData, taps, adWatchedType } = await req.json();

    if (!initData) {
      return NextResponse.json({ error: 'Missing initData', code: 'MISSING_INIT_DATA' }, { status: 400 });
    }

    // 1. Validate Telegram Signature
    const isValid = validateTelegramWebAppData(initData);
    if (!isValid && process.env.TELEGRAM_BOT_TOKEN) {
      console.warn(`[${requestId}] Invalid Telegram signature`);
      return NextResponse.json({ error: 'Invalid Telegram data', code: 'INVALID_SIGNATURE' }, { status: 403 });
    }

    // 2. Parse User Data
    const urlParams = new URLSearchParams(initData);
    const userStr = urlParams.get('user');
    if (!userStr) {
      return NextResponse.json({ error: 'No user data found', code: 'NO_USER_DATA' }, { status: 400 });
    }
    
    const tgUser = JSON.parse(decodeURIComponent(userStr));
    const telegramId = tgUser.id.toString();
    const now = Date.now();
    const todayStr = new Date(now).toISOString().split('T')[0];

    // 3. Fetch User from DB
    const users = await queryD1('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
    const user = users[0];

    if (!user) {
      // إذا المستخدم غير موجود، نطلب منه إعادة التشغيل ليقوم API auth بإنشائه
      return NextResponse.json({ error: 'User not found. Please restart the app.', code: 'USER_NOT_FOUND' }, { status: 404 });
    }

    // 4. Pre-Calculate States
    let newEnergy = calculateEnergyRegen(user, now);
    let botEarnings = calculateBotEarnings(user, now);
    
    let newCoins = user.coins + botEarnings;
    let newChallengeCoins = (user.challenge_coins || 0) + botEarnings;
    let newTotalTaps = user.total_taps;
    
    // متغيرات للتحديث
    let newTapMultiplier = user.tap_multiplier;
    let newTapMultiplierEndTime = user.tap_multiplier_end_time;
    let newAutoBotActiveUntil = user.auto_bot_active_until;
    let newAdsWatchedToday = user.ads_watched_today;
    let newLastAdWatchDate = user.last_ad_watch_date;
    let newReferralsActivated = user.referrals_activated;

    // تحقق من تاريخ آخر إعلان لإعادة تعيين العداد اليومي
    let lastAdDateStr = '';
    if (newLastAdWatchDate) {
      lastAdDateStr = newLastAdWatchDate.includes('T') ? newLastAdWatchDate.split('T')[0] : new Date(parseInt(newLastAdWatchDate)).toISOString().split('T')[0];
    }
    
    if (lastAdDateStr !== todayStr) {
      newAdsWatchedToday = 0;
    }

    // 5. Process Taps (Server-Side Validation)
    if (taps && Array.isArray(taps) && taps.length > 0) {
      // Anti-Cheat: Max 15 taps per second buffer
      const timeDiffSec = (now - user.last_update_time) / 1000;
      const maxTapsAllowed = Math.floor(timeDiffSec * 15) + 15; 
      const tapsToProcess = Math.min(taps.length, maxTapsAllowed);

      for (let i = 0; i < tapsToProcess; i++) {
        if (newEnergy >= 1) {
          newEnergy -= 1;
          newTotalTaps += 1;
          
          // Check Multiplier
          const isMultiplierActive = newTapMultiplierEndTime > now;
          const multiplier = isMultiplierActive ? newTapMultiplier : 1;
          
          newCoins += 1 * multiplier;
          newChallengeCoins += 1 * multiplier;
        }
      }
    }

    // 6. Process Ad Rewards
    if (adWatchedType) {
      // Check Daily Limit
      if (newAdsWatchedToday >= 30) {
        return NextResponse.json({ error: 'Daily ad limit reached (30/30)', code: 'LIMIT_REACHED' }, { status: 429 });
      }

      // Check Cooldown (30 seconds) - Optional but recommended
      const lastAdTimestamp = newLastAdWatchDate && !isNaN(Date.parse(newLastAdWatchDate)) 
        ? new Date(newLastAdWatchDate).getTime() 
        : (parseInt(newLastAdWatchDate) || 0);
      
      // إذا كان التاريخ نصاً قديماً (timestamp string) نحوله
      const timeSinceLastAd = now - (lastAdTimestamp || 0);
      if (timeSinceLastAd < 30000 && lastAdTimestamp !== 0) {
         // يمكن تفعيل هذا السطر إذا أردت فرض الانتظار 30 ثانية بدقة
         // return NextResponse.json({ error: 'Please wait before watching another ad', code: 'COOLDOWN' }, { status: 429 });
      }

      newAdsWatchedToday += 1;
      newLastAdWatchDate = new Date(now).toISOString(); // حفظ كـ ISO String

      // Apply Rewards
      newCoins += 1000;
      newChallengeCoins += 1000;

      if (adWatchedType === 'multiplier') {
        newTapMultiplier = 4;
        newTapMultiplierEndTime = now + 5 * 60 * 1000; // 5 mins
      } else if (adWatchedType === 'energy') {
        newEnergy = user.max_energy;
      } else if (adWatchedType === 'bot') {
        newAutoBotActiveUntil = now + 6 * 60 * 60 * 1000; // 6 hours
      }
    }

    // 7. Handle Referrals (Reward when reaching 500 taps for the first time)
    if (newTotalTaps >= 500 && user.total_taps < 500 && user.referred_by) {
      try {
        const referrers = await queryD1('SELECT coins, challenge_coins, referrals_activated, referral_coins_earned FROM users WHERE telegram_id = ?', [user.referred_by]);
        const referrer = referrers[0];

        if (referrer) {
          await executeD1(`
            UPDATE users 
            SET coins = coins + 1500, 
                challenge_coins = COALESCE(challenge_coins, 0) + 1500,
                referrals_activated = referrals_activated + 1, 
                referral_coins_earned = referral_coins_earned + 1500 
            WHERE telegram_id = ?
          `, [user.referred_by]);
          
          newReferralsActivated += 1;
          console.log(`[${requestId}] Referral reward granted: ${user.referred_by} invited ${telegramId}`);
        }
      } catch (e) {
        console.error(`[${requestId}] Failed to process referral reward:`, e);
      }
    }

    // 8. Update Database (Single Atomic Update)
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
      newEnergy, 
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

    // 9. Return Response
    return NextResponse.json({ 
      success: true, 
      user: {
        id: user.id,
        telegramId: user.telegram_id,
        coins: newCoins,
        challengeCoins: newChallengeCoins,
        energy: newEnergy,
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
        energyRecovered: newEnergy - user.energy,
        processedTaps: taps ? Math.min(taps.length, maxTapsAllowed) : 0
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
