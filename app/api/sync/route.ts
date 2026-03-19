import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { queryD1, executeD1 } from '@/lib/db';

// Helper to validate Telegram initData
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
    return false;
  }
}

function calculateEnergyRegen(user: any, now: number): number {
  const timePassedSec = (now - user.last_update_time) / 1000;
  if (timePassedSec <= 0) return user.energy;

  const regenRate = user.max_energy / 1800; // Full in 30 minutes
  const recoveredEnergy = timePassedSec * regenRate;
  return Math.min(user.max_energy, user.energy + recoveredEnergy);
}

function calculateBotEarnings(user: any, now: number): number {
  if (user.auto_bot_active_until <= user.last_update_time) return 0;

  const activeEndTime = Math.min(now, user.auto_bot_active_until);
  const activeSeconds = (activeEndTime - user.last_update_time) / 1000;
  
  if (activeSeconds <= 0) return 0;

  const rate = 0.5; // 0.5 coin per second
  return activeSeconds * rate;
}

export async function POST(req: Request) {
  try {
    const { initData, taps, adWatchedType } = await req.json();

    if (!initData) {
      return NextResponse.json({ error: 'Missing initData' }, { status: 400 });
    }

    // 1. Validate Telegram Data (Anti-Bot)
    const isValid = validateTelegramWebAppData(initData);
    if (!isValid && process.env.TELEGRAM_BOT_TOKEN) {
      return NextResponse.json({ error: 'Invalid Telegram data. Possible bot attack.' }, { status: 403 });
    }

    // Parse user data
    const urlParams = new URLSearchParams(initData);
    const userStr = urlParams.get('user');
    if (!userStr) {
      return NextResponse.json({ error: 'No user data found' }, { status: 400 });
    }

    const tgUser = JSON.parse(userStr);
    const telegramId = tgUser.id.toString();
    const now = Date.now();

    // 2. Fetch User from D1
    const users = await queryD1('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
    const user = users[0];

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // 3. Pre-calculate Energy Regen & Bot Earnings before applying taps
    let newEnergy = calculateEnergyRegen(user, now);
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

    // 4. Process Taps (Server-Side Validation)
    if (taps && Array.isArray(taps) && taps.length > 0) {
      // Anti-Cheat: Max 15 taps per second allowed
      const maxTapsAllowed = Math.floor((now - user.last_update_time) / 1000) * 15 + 15; // Allow some buffer
      const tapsToProcess = Math.min(taps.length, maxTapsAllowed);

      for (let i = 0; i < tapsToProcess; i++) {
        if (newEnergy >= 1) {
          newEnergy -= 1;
          newTotalTaps += 1;
          
          // Check multiplier using the tap's timestamp (with a small buffer for clock drift)
          const tapTime = taps[i].t || now;
          // Ensure tapTime is within the 5-minute window of the multiplier and after the last sync
          const multiplierStartTime = newTapMultiplierEndTime - 5 * 60 * 1000;
          const isMultiplierActive = tapTime >= multiplierStartTime - 5000 && 
                                     tapTime <= newTapMultiplierEndTime + 5000 &&
                                     tapTime >= user.last_update_time - 5000;
          const multiplier = isMultiplierActive ? newTapMultiplier : 1;
          
          newCoins += 1 * multiplier;
          newChallengeCoins += 1 * multiplier;
        }
      }
    }

    // 5. Process Ad Rewards (Server-Side Validation)
    if (adWatchedType) {
      const todayStr = new Date(now).toISOString().split('T')[0];
      
      let lastAdDateStr = '';
      let lastAdTimestamp = 0;
      
      if (newLastAdWatchDate) {
        if (newLastAdWatchDate.includes('T') || newLastAdWatchDate.includes('-')) {
           lastAdDateStr = newLastAdWatchDate.split('T')[0];
           lastAdTimestamp = new Date(newLastAdWatchDate).getTime();
        } else {
           lastAdTimestamp = parseInt(newLastAdWatchDate);
           lastAdDateStr = new Date(lastAdTimestamp).toISOString().split('T')[0];
        }
      }

      // Reset daily count if it's a new day
      if (lastAdDateStr !== todayStr) {
        newAdsWatchedToday = 0;
      }

      // Check daily limit (30 ads)
      if (newAdsWatchedToday >= 30) {
        return NextResponse.json({ error: 'Daily ad limit reached (30/30)' }, { status: 429 });
      }

      // Check cooldown between ads (e.g., 30 seconds)
      const timeSinceLastAd = now - lastAdTimestamp;
      if (timeSinceLastAd < 30000) {
        return NextResponse.json({ 
          error: `Ad cooldown active. Please wait ${Math.ceil((30000 - timeSinceLastAd) / 1000)} seconds.` 
        }, { status: 429 });
      }

      newAdsWatchedToday += 1;
      newLastAdWatchDate = now.toString();

      // Apply Rewards
      newCoins += 1000;
      newChallengeCoins += 1000;
      
      if (adWatchedType === 'multiplier') {
        newTapMultiplier = 4; // Changed to x4
        newTapMultiplierEndTime = now + 5 * 60 * 1000; // 5 mins
      } else if (adWatchedType === 'energy') {
        newEnergy = user.max_energy;
      } else if (adWatchedType === 'bot') {
        newAutoBotActiveUntil = now + 6 * 60 * 60 * 1000; // 6 hours
      }
    }

    // 6. Handle Referrals (if reaching 500 taps for the first time)
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
        }
      } catch (e) {
        console.error('Failed to process referral reward:', e);
      }
    }

    // 7. Save to Database (Single UPDATE, no SELECT needed)
    await executeD1(`
      UPDATE users SET 
        coins = ?, challenge_coins = ?, energy = ?, total_taps = ?, 
        tap_multiplier = ?, tap_multiplier_end_time = ?, 
        auto_bot_active_until = ?, ads_watched_today = ?, 
        last_ad_watch_date = ?, referrals_activated = ?, 
        last_update_time = ?
      WHERE telegram_id = ?
    `, [
      newCoins, newChallengeCoins, newEnergy, newTotalTaps,
      newTapMultiplier, newTapMultiplierEndTime,
      newAutoBotActiveUntil, newAdsWatchedToday,
      newLastAdWatchDate, newReferralsActivated,
      now, telegramId
    ]);

    const updatedUser = {
      ...user,
      coins: newCoins,
      challenge_coins: newChallengeCoins,
      energy: newEnergy,
      total_taps: newTotalTaps,
      tap_multiplier: newTapMultiplier,
      tap_multiplier_end_time: newTapMultiplierEndTime,
      auto_bot_active_until: newAutoBotActiveUntil,
      ads_watched_today: newAdsWatchedToday,
      last_ad_watch_date: newLastAdWatchDate,
      referrals_activated: newReferralsActivated,
      last_update_time: now,
      completed_tasks: JSON.parse(user.completed_tasks || '[]'),
      wallet_connected: Boolean(user.wallet_connected)
    };

    return NextResponse.json({ user: updatedUser, serverTime: now });
  } catch (error) {
    console.error('Sync API Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
