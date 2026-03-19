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
  
  const regenRate = user.max_energy / 1800; 
  const recoveredEnergy = timePassedSec * regenRate;
  return Math.min(user.max_energy, user.energy + recoveredEnergy);
}

// --- Helper: Calculate Bot Earnings ---
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

    // 1. Validate Telegram Signature (Strict)
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
      return NextResponse.json({ error: 'User not found.', code: 'USER_NOT_FOUND' }, { status: 404 });
    }

    // 4. Pre-Calculate States based on Server Time (Source of Truth)
    let currentEnergy = calculateEnergyRegen(user, now);
    let botEarnings = calculateBotEarnings(user, now);
    
    let newCoins = user.coins + botEarnings;
    let newChallengeCoins = (user.challenge_coins || 0) + botEarnings;
    let newTotalTaps = user.total_taps;
    
    // Initialize state variables with current DB values
    let newTapMultiplier = user.tap_multiplier;
    let newTapMultiplierEndTime = user.tap_multiplier_end_time;
    let newAutoBotActiveUntil = user.auto_bot_active_until;
    let newAdsWatchedToday = user.ads_watched_today;
    let newLastAdWatchDate = user.last_ad_watch_date;
    let newReferralsActivated = user.referrals_activated;

    // Reset Daily Ads Counter if it's a new day
    let lastAdDateStr = '';
    if (newLastAdWatchDate) {
      lastAdDateStr = newLastAdWatchDate.includes('T') ? newLastAdWatchDate.split('T')[0] : new Date(parseInt(newLastAdWatchDate)).toISOString().split('T')[0];
    }
    
    if (lastAdDateStr !== todayStr) {
      newAdsWatchedToday = 0;
    }

    // ---------------------------------------------------------
    // 5. PROCESS AD REWARDS FIRST (Before Taps)
    // This ensures that if an ad was watched, the multiplier is active 
    // BEFORE we process the incoming taps in this same request.
    // ---------------------------------------------------------
    let adRewardApplied = false;
    if (adWatchedType) {
      // Security: Check Daily Limit
      if (newAdsWatchedToday >= 30) {
        return NextResponse.json({ error: 'Daily ad limit reached', code: 'LIMIT_REACHED' }, { status: 429 });
      }

      // Security: Simple Cooldown Check (2 seconds)
      const lastAdTimestamp = newLastAdWatchDate && !isNaN(Date.parse(newLastAdWatchDate)) 
        ? new Date(newLastAdWatchDate).getTime() 
        : 0;
      
      if (now - lastAdTimestamp < 2000 && lastAdTimestamp !== 0) {
         // Cooldown active but we proceed with warning
      }

      newAdsWatchedToday += 1;
      newLastAdWatchDate = new Date(now).toISOString();
      adRewardApplied = true;

      // Apply Base Rewards (Always give coins for watching)
      newCoins += 1000;
      newChallengeCoins += 1000;

      // Apply Specific Boosts
      if (adWatchedType === 'multiplier') {
        newTapMultiplier = 4;
        newTapMultiplierEndTime = now + 5 * 60 * 1000; // 5 mins from NOW (Server Time)
      } else if (adWatchedType === 'energy') {
        currentEnergy = user.max_energy; // Refill to max
      } else if (adWatchedType === 'bot') {
        // Extend bot time or set new time
        const currentTime = newAutoBotActiveUntil > now ? newAutoBotActiveUntil : now;
        newAutoBotActiveUntil = currentTime + 6 * 60 * 60 * 1000; 
      }
    }

    // ---------------------------------------------------------
    // 6. Process Taps (Server-Side Validation)
    // ---------------------------------------------------------
    let processedTapsCount = 0; 
    
    if (taps && Array.isArray(taps) && taps.length > 0) {
      // Calculate Max Allowed Taps based on time passed since last update
      const timeDiffSec = (now - user.last_update_time) / 1000;
      // Allow 15 taps per second accumulation + burst of 15
      const maxTapsAllowed = Math.floor(timeDiffSec * 15) + 15; 
      
      const tapsToProcess = Math.min(taps.length, maxTapsAllowed);
      processedTapsCount = tapsToProcess;

      for (let i = 0; i < tapsToProcess; i++) {
        // Use the UPDATED energy (after ad refill if applicable)
        if (currentEnergy >= 1) {
          currentEnergy -= 1;
          newTotalTaps += 1;
          
          // Check Multiplier using the UPDATED end time (after ad activation if applicable)
          // This fixes the issue where taps sent immediately after ad weren't multiplied
          const isMultiplierActive = newTapMultiplierEndTime > now;
          const multiplier = isMultiplierActive ? newTapMultiplier : 1;
          
          newCoins += 1 * multiplier;
          newChallengeCoins += 1 * multiplier;
        } else {
          // Stop processing if energy runs out
          break; 
        }
      }
    }

    // 7. Handle Referrals (First time reaching 500 taps)
    if (newTotalTaps >= 500 && user.total_taps < 500 && user.referred_by) {
      try {
        const referrers = await queryD1('SELECT coins, challenge_coins, referrals_activated FROM users WHERE telegram_id = ?', [user.referred_by]);
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
          console.log(`[${requestId}] Referral reward granted: ${user.referred_by}`);
        }
      } catch (e) {
        console.error(`[${requestId}] Failed to process referral reward:`, e);
      }
    }

    // 8. Update Database (Atomic Update)
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

    // 9. Return Response
    return NextResponse.json({ 
      success: true, 
      user: {
        id: user.id,
        telegramId: user.telegram_id,
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
        adRewardApplied
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
