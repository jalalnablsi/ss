import { NextResponse } from 'next/server';
import { queryD1, executeD1 } from '@/lib/db';

// --- Crypto Functions ---
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

async function validateTelegram(initData: string): Promise<boolean> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return true; // Development mode
  
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return false;
    
    params.delete('hash');
    const dataCheckString = Array.from(params.keys()).sort()
      .map(k => `${k}=${params.get(k)}`).join('\n');
    
    const secretKey = await hmacSha256('WebAppData', botToken);
    const calculatedHash = bufferToHex(await hmacSha256(secretKey, dataCheckString));
    
    return calculatedHash === hash;
  } catch {
    return false;
  }
}

// --- Rate Limiting (In-Memory for Edge) ---
const rateLimits = new Map<string, { count: number; resetTime: number }>();

function checkRateLimit(telegramId: string): boolean {
  const now = Date.now();
  const windowMs = 1000; // 1 second window
  const maxRequests = 15; // 15 requests per second max
  
  const current = rateLimits.get(telegramId);
  
  if (!current || now > current.resetTime) {
    rateLimits.set(telegramId, { count: 1, resetTime: now + windowMs });
    return true;
  }
  
  if (current.count >= maxRequests) {
    return false;
  }
  
  current.count++;
  return true;
}

// --- Anti-Cheat Validation ---
function validateBatch(batch: any, userEnergy: number): { valid: boolean; error?: string; acceptedTaps?: number } {
  if (!batch || typeof batch.taps !== 'number') {
    return { valid: false, error: 'Invalid batch format' };
  }

  const { taps, timestamps, sequence } = batch;
  
  // 1. Check tap count sanity
  if (taps <= 0 || taps > 100) {
    return { valid: false, error: 'Invalid tap count' };
  }
  
  // 2. Check energy availability (server-side truth)
  if (taps > userEnergy) {
    return { valid: true, acceptedTaps: userEnergy }; // Accept what we can
  }
  
  // 3. Bot detection via timestamp analysis
  if (timestamps && Array.isArray(timestamps) && timestamps.length > 5) {
    const intervals = [];
    for (let i = 1; i < timestamps.length; i++) {
      intervals.push(timestamps[i] - timestamps[i-1]);
    }
    
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) / intervals.length;
    
    // If variance is too low = bot pattern
    if (variance < 50 && taps > 10) {
      console.warn(`[ANTI-CHEAT] Bot pattern detected for sequence ${sequence}`);
      // Still accept but log for review
    }
  }
  
  return { valid: true, acceptedTaps: taps };
}

// --- Main Handler ---
export async function POST(req: Request) {
  const startTime = performance.now();
  
  try {
    const body = await req.json();
    const { initData, batch, adWatchedType } = body;

    // 1. Validation
    if (!initData) {
      return NextResponse.json({ error: 'Missing initData' }, { status: 400 });
    }

    const isValid = await validateTelegram(initData);
    if (!isValid && process.env.TELEGRAM_BOT_TOKEN) {
      return NextResponse.json({ error: 'Invalid Telegram data' }, { status: 403 });
    }

    // 2. Extract User
    const urlParams = new URLSearchParams(initData);
    const userStr = urlParams.get('user');
    if (!userStr) {
      return NextResponse.json({ error: 'No user data' }, { status: 400 });
    }

    const tgUser = JSON.parse(userStr);
    const telegramId = tgUser.id?.toString();
    
    if (!telegramId) {
      return NextResponse.json({ error: 'Invalid user' }, { status: 400 });
    }

    // 3. Rate Limit Check
    if (!checkRateLimit(telegramId)) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    // 4. Fetch User (Single Query)
    const users = await queryD1(
      'SELECT * FROM users WHERE telegram_id = ?',
      [telegramId]
    );
    
    const user = users[0];
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const now = Date.now();
    const todayStr = new Date().toISOString().split('T')[0];

    // 5. Calculate Energy Regeneration
    const timePassedSec = Math.floor((now - user.last_update_time) / 1000);
    const regenRate = user.max_energy / 1800; // Full in 30 min
    const recoveredEnergy = Math.floor(timePassedSec * regenRate);
    const currentEnergy = Math.min(user.max_energy, user.energy + recoveredEnergy);

    // 6. Process Batch Taps
    let finalCoins = user.coins;
    let finalEnergy = currentEnergy;
    let finalTotalTaps = user.total_taps;
    let finalChallengeCoins = user.challenge_coins || 0;
    let tapsProcessed = 0;

    if (batch && batch.taps > 0) {
      const validation = validateBatch(batch, currentEnergy);
      
      if (!validation.valid) {
        return NextResponse.json({ error: validation.error }, { status: 400 });
      }

      tapsProcessed = validation.acceptedTaps || 0;
      
      // Calculate multiplier
      const isMultiplierActive = user.tap_multiplier_end_time > now;
      const multiplier = isMultiplierActive ? user.tap_multiplier : 1;
      
      const earnedCoins = tapsProcessed * multiplier;
      
      finalCoins += earnedCoins;
      finalChallengeCoins += earnedCoins;
      finalEnergy = Math.max(0, currentEnergy - tapsProcessed);
      finalTotalTaps += tapsProcessed;
    }

    // 7. Process Ad Rewards
    let newMultiplier = user.tap_multiplier;
    let newMultiplierEnd = user.tap_multiplier_end_time;
    let newBotEnd = user.auto_bot_active_until;
    let newAdsWatchedToday = user.ads_watched_today;
    let newLastAdWatchDate = user.last_ad_watch_date;

    // Reset daily ads if new day
    if (newLastAdWatchDate !== todayStr) {
      newAdsWatchedToday = 0;
      newLastAdWatchDate = todayStr;
    }

    if (adWatchedType) {
      // Check limits
      if (newAdsWatchedToday >= 30) {
        return NextResponse.json({ error: 'Daily ad limit reached' }, { status: 429 });
      }

      // Check hourly limit
      const oneHourAgo = new Date(now - 3600000).toISOString();
      const recentAds = await queryD1(
        'SELECT COUNT(*) as c FROM ad_watches WHERE telegram_id = ? AND watched_at >= ?',
        [telegramId, oneHourAgo]
      );
      
      if ((recentAds[0]?.c || 0) >= 5) {
        return NextResponse.json({ error: 'Hourly ad limit reached' }, { status: 429 });
      }

      // Record ad watch
      await executeD1(
        'INSERT INTO ad_watches (id, telegram_id, watched_at) VALUES (?, ?, ?)',
        [crypto.randomUUID(), telegramId, new Date(now).toISOString()]
      );

      newAdsWatchedToday++;
      finalCoins += 1000;
      finalChallengeCoins += 1000;

      // Apply rewards
      switch (adWatchedType) {
        case 'multiplier':
          newMultiplier = 4; // ✅ x4 instead of x2
          newMultiplierEnd = now + 300000; // 5 minutes
          break;
        case 'energy':
          finalEnergy = user.max_energy;
          break;
        case 'bot':
          newBotEnd = now + 21600000; // 6 hours
          break;
      }
    }

    // 8. Check Referral Milestone (500 taps)
    if (finalTotalTaps >= 500 && user.total_taps < 500 && user.referred_by) {
      console.log(`[REFERRAL] User ${telegramId} reached 500 taps! Rewarding referrer ${user.referred_by}`);
      
      // Update referrer
      await executeD1(`
        UPDATE users 
        SET 
          coins = coins + 1500,
          challenge_coins = COALESCE(challenge_coins, 0) + 1500,
          referrals_activated = referrals_activated + 1,
          referral_coins_earned = COALESCE(referral_coins_earned, 0) + 1500
        WHERE telegram_id = ?
      `, [user.referred_by]);

      // Mark user as activated
      await executeD1(`
        UPDATE users SET referrals_activated = 1 WHERE telegram_id = ?
      `, [telegramId]);
    }

    // 9. Single Atomic Update
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
        last_update_time = ?
      WHERE telegram_id = ?
    `, [
      finalCoins,
      finalChallengeCoins,
      finalEnergy,
      finalTotalTaps,
      newMultiplier,
      newMultiplierEnd,
      newBotEnd,
      newAdsWatchedToday,
      newLastAdWatchDate,
      now,
      telegramId
    ]);

    // 10. Fetch updated user
    const updatedUsers = await queryD1(
      'SELECT * FROM users WHERE telegram_id = ?',
      [telegramId]
    );
    
    const updatedUser = updatedUsers[0];
    
    // Format response
    const response = {
      user: {
        ...updatedUser,
        completed_tasks: JSON.parse(updatedUser.completed_tasks || '[]'),
        wallet_connected: Boolean(updatedUser.wallet_connected)
      },
      serverTime: now,
      debug: {
        tapsProcessed,
        coinsEarned: finalCoins - user.coins,
        energyUsed: currentEnergy - finalEnergy,
        processingTime: Math.round(performance.now() - startTime)
      }
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('[SYNC] Critical error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    );
  }
}
