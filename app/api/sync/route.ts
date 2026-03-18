// app/api/sync/route.ts
import { NextResponse } from 'next/server';
import { queryD1, executeD1 } from '@/lib/db';
import { validateTelegramWebAppData, parseInitData } from '@/lib/telegram';

// --- Rate Limiting (In-Memory for Edge Runtime) ---
const rateLimits = new Map<string, { count: number; resetTime: number }>();

function checkRateLimit(telegramId: string): boolean {
  const now = Date.now();
  const windowMs = 1000; // 1 second
  const maxRequests = 20; // 20 requests per second max

  const current = rateLimits.get(telegramId);

  if (!current || now > current.resetTime) {
    rateLimits.set(telegramId, { count: 1, resetTime: now + windowMs });
    return true;
  }

  if (current.count >= maxRequests) {
    console.warn(`[RATE_LIMIT] Blocked ${telegramId}`);
    return false;
  }

  current.count++;
  return true;
}

// --- Anti-Cheat: Validate Batch ---
function validateBatch(batch: any, userEnergy: number): { 
  valid: boolean; 
  error?: string; 
  acceptedTaps?: number;
  isBot?: boolean;
} {
  if (!batch || typeof batch.taps !== 'number') {
    return { valid: false, error: 'Invalid batch format' };
  }

  const { taps, timestamps } = batch;

  // Sanity checks
  if (taps <= 0) return { valid: true, acceptedTaps: 0 };
  if (taps > 100) return { valid: false, error: 'Batch too large (max 100)' };

  // Check energy limit
  let acceptedTaps = Math.min(taps, userEnergy);
  
  // Bot detection via timestamp variance
  let isBot = false;
  if (timestamps && Array.isArray(timestamps) && timestamps.length >= 5) {
    const intervals = [];
    for (let i = 1; i < timestamps.length; i++) {
      intervals.push(timestamps[i] - timestamps[i-1]);
    }

    if (intervals.length > 0) {
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const variance = intervals.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) / intervals.length;

      // Low variance = bot pattern (human taps are irregular)
      if (variance < 100 && taps > 10) {
        console.warn(`[ANTI-CHEAT] Bot pattern detected: variance=${variance.toFixed(2)}`);
        isBot = true;
        // Still accept but flag for review (or reject if strict)
        // acceptedTaps = 0; // Uncomment to strictly reject
      }
    }
  }

  return { valid: true, acceptedTaps, isBot };
}

// --- Main Handler ---
export async function POST(req: Request) {
  const startTime = performance.now();
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    const body = await req.json();
    const { initData, batch, adWatchedType } = body;

    // 1. Validate Telegram
    if (!initData) {
      return NextResponse.json(
        { error: 'Missing initData', code: 'MISSING_INIT_DATA' },
        { status: 400 }
      );
    }

    const isValid = await validateTelegramWebAppData(initData);
    if (!isValid) {
      console.error(`[${requestId}] Invalid Telegram signature`);
      return NextResponse.json(
        { error: 'Access Denied - Invalid signature', code: 'INVALID_SIGNATURE' },
        { status: 403 }
      );
    }

    // 2. Extract User
    const tgUser = parseInitData(initData);
    if (!tgUser?.id) {
      return NextResponse.json(
        { error: 'No user data', code: 'NO_USER_DATA' },
        { status: 400 }
      );
    }

    const telegramId = tgUser.id.toString();

    // 3. Rate Limit
    if (!checkRateLimit(telegramId)) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', code: 'RATE_LIMIT' },
        { status: 429 }
      );
    }

    // 4. Fetch User
    const users = await queryD1(
      'SELECT * FROM users WHERE telegram_id = ?',
      [telegramId]
    );

    const user = users[0];
    if (!user) {
      return NextResponse.json(
        { error: 'User not found', code: 'USER_NOT_FOUND' },
        { status: 404 }
      );
    }

    const now = Date.now();
    const todayStr = new Date(now).toISOString().split('T')[0];

    // 5. Calculate Energy Regeneration
    const timePassedSec = Math.floor((now - user.last_update_time) / 1000);
    const regenRate = user.max_energy / 1800; // Full in 30 min
    const recoveredEnergy = Math.floor(timePassedSec * regenRate);
    const currentEnergy = Math.min(user.max_energy, user.energy + recoveredEnergy);

    // 6. Process Batch Taps
    let finalCoins = user.coins;
    let finalChallengeCoins = user.challenge_coins || 0;
    let finalEnergy = currentEnergy;
    let finalTotalTaps = user.total_taps;
    let tapsProcessed = 0;
    let botDetected = false;

    if (batch && batch.taps > 0) {
      const validation = validateBatch(batch, currentEnergy);

      if (!validation.valid) {
        return NextResponse.json(
          { error: validation.error, code: 'INVALID_BATCH' },
          { status: 400 }
        );
      }

      tapsProcessed = validation.acceptedTaps || 0;
      botDetected = validation.isBot || false;

      if (tapsProcessed > 0) {
        // Calculate multiplier
        const isMultiplierActive = user.tap_multiplier_end_time > now;
        const multiplier = isMultiplierActive ? user.tap_multiplier : 1;

        const earnedCoins = tapsProcessed * multiplier;

        finalCoins += earnedCoins;
        finalChallengeCoins += earnedCoins;
        finalEnergy = Math.max(0, currentEnergy - tapsProcessed);
        finalTotalTaps += tapsProcessed;

        if (window.Telegram?.WebApp?.HapticFeedback && botDetected) {
          // Notify client of bot detection
          console.warn(`[${requestId}] Bot flagged for user ${telegramId}`);
        }
      }
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
      // Check daily limit (30 ads/day)
      if (newAdsWatchedToday >= 30) {
        return NextResponse.json(
          { error: 'Daily ad limit reached (30)', code: 'DAILY_AD_LIMIT' },
          { status: 429 }
        );
      }

      // Check hourly limit (5 ads/hour)
      const oneHourAgo = new Date(now - 3600000).toISOString();
      const recentAds = await queryD1(
        `SELECT COUNT(*) as c FROM ad_watches 
         WHERE telegram_id = ? AND watched_at >= ?`,
        [telegramId, oneHourAgo]
      );

      if ((recentAds[0]?.c || 0) >= 5) {
        return NextResponse.json(
          { error: 'Hourly ad limit reached (5)', code: 'HOURLY_AD_LIMIT' },
          { status: 429 }
        );
      }

      // Record ad watch
      await executeD1(
        `INSERT INTO ad_watches (id, telegram_id, watched_at) 
         VALUES (?, ?, ?)`,
        [crypto.randomUUID(), telegramId, new Date(now).toISOString()]
      );

      newAdsWatchedToday++;
      finalCoins += 1000;
      finalChallengeCoins += 1000;

      // Apply ad rewards
      switch (adWatchedType) {
        case 'multiplier':
          newMultiplier = 4; // ✅ x4 multiplier
          newMultiplierEnd = now + 300000; // 5 minutes
          break;
        case 'energy':
          finalEnergy = user.max_energy;
          break;
        case 'bot':
          newBotEnd = now + 21600000; // 6 hours
          break;
        default:
          console.warn(`[${requestId}] Unknown ad type: ${adWatchedType}`);
      }
    }

    // 8. Check Referral Milestone (500 taps)
    let referralRewarded = false;
    if (finalTotalTaps >= 500 && user.total_taps < 500 && user.referred_by) {
      console.log(`[${requestId}] Referral milestone! ${telegramId} -> ${user.referred_by}`);

      // Update referrer (atomic)
      const referrerUpdate = await executeD1(
        `UPDATE users 
         SET coins = coins + 1500,
             challenge_coins = COALESCE(challenge_coins, 0) + 1500,
             referrals_activated = referrals_activated + 1,
             referral_coins_earned = COALESCE(referral_coins_earned, 0) + 1500
         WHERE telegram_id = ?`,
        [user.referred_by]
      );

      if (referrerUpdate.success) {
        referralRewarded = true;
        console.log(`[${requestId}] Referrer rewarded: ${user.referred_by}`);
      }
    }

    // 9. Atomic Update (Single Query)
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
        last_update_time = ?,
        referrals_activated = CASE WHEN ? THEN 1 ELSE referrals_activated END
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
        now,
        referralRewarded, // For CASE statement
        telegramId
      ]
    );

    // 10. Fetch Updated User
    const updatedUsers = await queryD1(
      'SELECT * FROM users WHERE telegram_id = ?',
      [telegramId]
    );

    const updatedUser = updatedUsers[0];

    const duration = Math.round(performance.now() - startTime);
    console.log(`[${requestId}] Sync: ${tapsProcessed} taps, ${duration}ms${botDetected ? ' [BOT]' : ''}`);

    // 11. Response
    return NextResponse.json({
      success: true,
      user: {
        id: updatedUser.id,
        telegram_id: updatedUser.telegram_id,
        first_name: updatedUser.first_name,
        last_name: updatedUser.last_name,
        username: updatedUser.username,
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
        wallet_connected: Boolean(updatedUser.wallet_connected),
        referrals_count: updatedUser.referrals_count,
        referrals_activated: updatedUser.referrals_activated,
        referral_coins_earned: updatedUser.referral_coins_earned,
        completed_tasks: JSON.parse(updatedUser.completed_tasks || '[]')
      },
      serverTime: now,
      meta: {
        tapsProcessed,
        coinsEarned: finalCoins - user.coins,
        energyUsed: currentEnergy - finalEnergy,
        multiplierActive: newMultiplierEnd > now,
        botDetected,
        referralRewarded,
        processingTimeMs: duration
      }
    });

  } catch (error) {
    console.error(`[${requestId}] Critical error:`, error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

// Handle GET for health check
export async function GET() {
  return NextResponse.json({ status: 'ok', endpoint: 'sync' });
}
