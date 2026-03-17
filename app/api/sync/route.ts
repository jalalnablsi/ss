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

    let newCoins = user.coins;
    let newChallengeCoins = user.challenge_coins || 0;
    let newEnergy = user.energy;
    let newTotalTaps = user.total_taps;
    let newTapMultiplier = user.tap_multiplier;
    let newTapMultiplierEndTime = user.tap_multiplier_end_time;
    let newAutoBotActiveUntil = user.auto_bot_active_until;
    let newAdsWatchedToday = user.ads_watched_today;
    let newLastAdWatchDate = user.last_ad_watch_date;
    let newReferralsActivated = user.referrals_activated;

    // 3. Process Taps (Server-Side Validation)
    if (taps && Array.isArray(taps) && taps.length > 0) {
      // Anti-Cheat: Max 15 taps per second allowed
      const maxTapsAllowed = Math.floor((now - user.last_update_time) / 1000) * 15 + 15; // Allow some buffer
      const tapsToProcess = Math.min(taps.length, maxTapsAllowed);

      for (let i = 0; i < tapsToProcess; i++) {
        if (newEnergy >= 1) {
          newEnergy -= 1;
          newTotalTaps += 1;
          
          // Check multiplier
          const multiplier = newTapMultiplierEndTime > now ? newTapMultiplier : 1;
          newCoins += 1 * multiplier;
          newChallengeCoins += 1 * multiplier;
        }
      }
    }

    // 4. Process Ad Rewards (Server-Side Validation)
    if (adWatchedType) {
      const today = new Date().toISOString().split('T')[0];
      
      // Reset daily count if it's a new day
      if (newLastAdWatchDate !== today) {
        newAdsWatchedToday = 0;
      }

      // Check daily limit (30 ads)
      if (newAdsWatchedToday >= 30) {
        return NextResponse.json({ error: 'Daily ad limit reached (30/30)' }, { status: 429 });
      }

      // Check hourly limit (5 ads)
      const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();
      const recentAds = await queryD1('SELECT COUNT(*) as count FROM ad_watches WHERE telegram_id = ? AND watched_at >= ?', [telegramId, oneHourAgo]);
      const adsLastHour = recentAds[0]?.count || 0;

      if (adsLastHour >= 5) {
        return NextResponse.json({ error: 'Hourly ad limit reached (5/5). Please wait.' }, { status: 429 });
      }

      // Check cooldown between ads
      const lastAds = await queryD1('SELECT watched_at FROM ad_watches WHERE telegram_id = ? ORDER BY watched_at DESC LIMIT 1', [telegramId]);
      const lastAd = lastAds[0];

      if (lastAd) {
        const lastAdTime = new Date(lastAd.watched_at).getTime();
        const timeSinceLastAd = now - lastAdTime;
        
        const requiredCooldown = adsLastHour * 30 * 1000; 

        if (timeSinceLastAd < requiredCooldown) {
           return NextResponse.json({ 
             error: `Ad cooldown active. Please wait ${Math.ceil((requiredCooldown - timeSinceLastAd) / 1000)} seconds.` 
           }, { status: 429 });
        }
      }

      // Record the ad watch
      await executeD1('INSERT INTO ad_watches (id, telegram_id, watched_at) VALUES (?, ?, ?)', [
        crypto.randomUUID(), telegramId, new Date(now).toISOString()
      ]);

      newAdsWatchedToday += 1;
      newLastAdWatchDate = today;

      // Apply Rewards
      newCoins += 1000;
      newChallengeCoins += 1000;
      
      if (adWatchedType === 'multiplier') {
        newTapMultiplier = 2;
        newTapMultiplierEndTime = now + 5 * 60 * 1000; // 5 mins
      } else if (adWatchedType === 'energy') {
        newEnergy = user.max_energy;
      } else if (adWatchedType === 'bot') {
        newAutoBotActiveUntil = now + 6 * 60 * 60 * 1000; // 6 hours
      }
    }

    // 4.5 Handle Referrals (if reaching 500 taps for the first time)
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

    // 5. Save to Database
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

    const updatedUsers = await queryD1('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
    const updatedUser = updatedUsers[0];
    
    updatedUser.completed_tasks = JSON.parse(updatedUser.completed_tasks || '[]');
    updatedUser.wallet_connected = Boolean(updatedUser.wallet_connected);

    return NextResponse.json({ user: updatedUser, serverTime: now });
  } catch (error) {
    console.error('Sync API Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
