// app/api/auth/route.ts
import { NextResponse } from 'next/server';
import { queryD1, executeD1 } from '@/lib/db';
import { validateTelegramWebAppData, parseInitData } from '@/lib/telegram';

// --- Types ---
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
  total_taps: number;
  tap_multiplier: number;
  tap_multiplier_end_time: number;
  auto_bot_active_until: number;
  ads_watched_today: number;
  last_ad_watch_date: string;
  last_update_time: number;
  wallet_connected: number;
  wallet_address: string | null;
  referrals_count: number;
  referrals_activated: number;
  referral_coins_earned: number;
  referred_by: string | null;
  completed_tasks: string;
  created_at: string;
}

// --- Rate Limiting ---
const authRateLimits = new Map<string, { count: number; resetTime: number }>();

function checkAuthRateLimit(identifier: string): boolean {
  const now = Date.now();
  const windowMs = 60000; // 1 minute
  const maxRequests = 10; // 10 auth requests per minute max

  const current = authRateLimits.get(identifier);

  if (!current || now > current.resetTime) {
    authRateLimits.set(identifier, { count: 1, resetTime: now + windowMs });
    return true;
  }

  if (current.count >= maxRequests) {
    return false;
  }

  current.count++;
  return true;
}

// --- Helper Functions ---
function calculateEnergyRegen(user: UserRecord, now: number): number {
  const timePassedSec = Math.floor((now - user.last_update_time) / 1000);
  if (timePassedSec <= 0) return user.energy;

  const regenRate = user.max_energy / 1800; // Full in 30 minutes
  const recoveredEnergy = Math.floor(timePassedSec * regenRate);
  return Math.min(user.max_energy, user.energy + recoveredEnergy);
}

function calculateBotEarnings(user: UserRecord, now: number): number {
  if (user.auto_bot_active_until <= user.last_update_time) return 0;

  const activeEndTime = Math.min(now, user.auto_bot_active_until);
  const activeSeconds = Math.floor((activeEndTime - user.last_update_time) / 1000);
  
  if (activeSeconds <= 0) return 0;

  const rate = 0.5; // 0.5 coin per second
  return Math.floor(activeSeconds * rate);
}

// --- Main Handler ---
export async function POST(req: Request) {
  const startTime = performance.now();
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    // 1. Parse Request
    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body', code: 'INVALID_JSON' },
        { status: 400 }
      );
    }

    const { initData, referralCode } = body;

    if (!initData || typeof initData !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid initData', code: 'MISSING_INIT_DATA' },
        { status: 400 }
      );
    }

    // 2. Validate Telegram
    const isValid = await validateTelegramWebAppData(initData);
    if (!isValid) {
      console.error(`[${requestId}] Invalid Telegram signature`);
      return NextResponse.json(
        { error: 'Access Denied - Invalid signature', code: 'INVALID_SIGNATURE' },
        { status: 403 }
      );
    }

    // 3. Extract User Data
    const tgUser = parseInitData(initData) as TelegramUser | null;
    if (!tgUser?.id) {
      return NextResponse.json(
        { error: 'No valid user data found', code: 'NO_USER_DATA' },
        { status: 400 }
      );
    }

    const telegramId = tgUser.id.toString();

    // 4. Rate Limit Check
    if (!checkAuthRateLimit(telegramId)) {
      return NextResponse.json(
        { error: 'Too many auth attempts', code: 'AUTH_RATE_LIMIT' },
        { status: 429 }
      );
    }

    const now = Date.now();
    const todayStr = new Date(now).toISOString().split('T')[0];

    // 5. Get or Create User
    let user: UserRecord | undefined = await queryD1<UserRecord>(
      'SELECT * FROM users WHERE telegram_id = ? LIMIT 1',
      [telegramId]
    ).then(r => r[0]);

    let isNewUser = false;
    let botEarnings = 0;

    if (!user) {
      // Create New User
      isNewUser = true;
      const id = crypto.randomUUID();

      await executeD1(
        `INSERT INTO users (
          id, telegram_id, first_name, last_name, username,
          coins, challenge_coins, energy, max_energy, total_taps,
          tap_multiplier, tap_multiplier_end_time, auto_bot_active_until,
          ads_watched_today, last_ad_watch_date, last_update_time,
          wallet_connected, wallet_address, referrals_count, referrals_activated,
          referral_coins_earned, referred_by, completed_tasks, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(telegram_id) DO UPDATE SET
          first_name = excluded.first_name,
          last_name = excluded.last_name,
          username = excluded.username,
          last_update_time = excluded.last_update_time`,
        [
          id,
          telegramId,
          tgUser.first_name || '',
          tgUser.last_name || null,
          tgUser.username || null,
          0, // coins
          0, // challenge_coins
          500, // energy
          500, // max_energy
          0, // total_taps
          1, // tap_multiplier
          0, // tap_multiplier_end_time
          0, // auto_bot_active_until
          0, // ads_watched_today
          todayStr, // last_ad_watch_date
          now, // last_update_time
          0, // wallet_connected
          null, // wallet_address
          0, // referrals_count
          0, // referrals_activated
          0, // referral_coins_earned
          referralCode && referralCode !== telegramId ? referralCode : null, // referred_by
          '[]', // completed_tasks
          new Date(now).toISOString() // created_at
        ]
      );

      // Process referral for new user
      if (referralCode && referralCode !== telegramId) {
        try {
          await executeD1(
            `UPDATE users SET referrals_count = referrals_count + 1 WHERE telegram_id = ?`,
            [referralCode]
          );
          console.log(`[${requestId}] Referral recorded: ${referralCode} invited ${telegramId}`);
        } catch (err) {
          console.error(`[${requestId}] Failed to record referral:`, err);
        }
      }

      // Fetch created user
      const newUser = await queryD1<UserRecord>(
        'SELECT * FROM users WHERE telegram_id = ? LIMIT 1',
        [telegramId]
      ).then(r => r[0]);
      
      if (!newUser) throw new Error('Failed to fetch created user');
      user = newUser;

    } else {
      // Existing User: Calculate updates
      const currentEnergy = calculateEnergyRegen(user, now);
      botEarnings = calculateBotEarnings(user, now);

      // Update user with regenerated energy and bot earnings
      if (currentEnergy !== user.energy || botEarnings > 0) {
        await executeD1(
          `UPDATE users SET 
            energy = ?,
            coins = coins + ?,
            challenge_coins = challenge_coins + ?,
            last_update_time = ?
          WHERE telegram_id = ?`,
          [currentEnergy, botEarnings, botEarnings, now, telegramId]
        );

        // Refresh user data
        const updatedUser = await queryD1<UserRecord>(
          'SELECT * FROM users WHERE telegram_id = ? LIMIT 1',
          [telegramId]
        ).then(r => r[0]);
        
        if (updatedUser) user = updatedUser;
      }

      // Reset daily ads if new day
      if (user.last_ad_watch_date !== todayStr) {
        await executeD1(
          `UPDATE users SET ads_watched_today = 0, last_ad_watch_date = ? WHERE telegram_id = ?`,
          [todayStr, telegramId]
        );
        user.ads_watched_today = 0;
        user.last_ad_watch_date = todayStr;
      }

      // Update profile info if changed
      if (
        user.first_name !== (tgUser.first_name || '') ||
        user.last_name !== (tgUser.last_name || null) ||
        user.username !== (tgUser.username || null)
      ) {
        await executeD1(
          `UPDATE users SET first_name = ?, last_name = ?, username = ? WHERE telegram_id = ?`,
          [tgUser.first_name || '', tgUser.last_name || null, tgUser.username || null, telegramId]
        );
        user.first_name = tgUser.first_name || '';
        user.last_name = tgUser.last_name || null;
        user.username = tgUser.username || null;
      }
    }

    // 6. Calculate final energy (after all updates)
    const finalEnergy = calculateEnergyRegen(user, now);

    // 7. Build Response
    const duration = Math.round(performance.now() - startTime);
    console.log(`[${requestId}] Auth ${isNewUser ? 'created' : 'success'} for ${telegramId} in ${duration}ms`);

    return NextResponse.json({
      success: true,
      isNewUser,
      user: {
        id: user.id,
        telegramId: user.telegram_id,
        firstName: user.first_name,
        lastName: user.last_name,
        username: user.username,
        coins: user.coins,
        challengeCoins: user.challenge_coins,
        energy: finalEnergy,
        maxEnergy: user.max_energy,
        totalTaps: user.total_taps,
        tapMultiplier: user.tap_multiplier,
        tapMultiplierEndTime: user.tap_multiplier_end_time,
        autoBotActiveUntil: user.auto_bot_active_until,
        adsWatchedToday: user.ads_watched_today,
        lastAdWatchDate: user.last_ad_watch_date,
        walletConnected: Boolean(user.wallet_connected),
        walletAddress: user.wallet_address,
        referralsCount: user.referrals_count,
        referralsActivated: user.referrals_activated,
        referralCoinsEarned: user.referral_coins_earned,
        referredBy: user.referred_by,
        completedTasks: JSON.parse(user.completed_tasks || '[]'),
        createdAt: user.created_at
      },
      serverTime: now,
      meta: {
        isNewUser,
        botEarnings,
        energyRecovered: finalEnergy - user.energy,
        processingTimeMs: duration
      }
    });

  } catch (error) {
    console.error(`[${requestId}] Auth error:`, error);
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

// Health check endpoint
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    endpoint: 'auth',
    timestamp: Date.now()
  });
}
