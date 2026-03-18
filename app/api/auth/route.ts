import { NextResponse } from 'next/server';
import { queryD1, executeD1 } from '@/lib/db';

// --- Crypto (Same as sync) ---
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

async function validateTelegram(initData: string, botToken?: string): Promise<{
  valid: boolean;
  user?: any;
  error?: string;
}> {
  if (!botToken) {
    console.warn('[AUTH] No bot token - dev mode');
    try {
      const params = new URLSearchParams(initData);
      const userStr = params.get('user');
      return { valid: true, user: userStr ? JSON.parse(userStr) : null };
    } catch {
      return { valid: false, error: 'Invalid user data' };
    }
  }

  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    if (!hash) return { valid: false, error: 'Missing hash' };

    urlParams.delete('hash');
    const dataCheckString = Array.from(urlParams.keys()).sort()
      .map(k => `${k}=${urlParams.get(k)}`).join('\n');

    const secretKey = await hmacSha256('WebAppData', botToken);
    const calculatedHash = bufferToHex(await hmacSha256(secretKey, dataCheckString));

    if (calculatedHash !== hash) {
      return { valid: false, error: 'Invalid signature' };
    }

    const userStr = urlParams.get('user');
    return { valid: true, user: userStr ? JSON.parse(userStr) : null };
  } catch (error) {
    return { valid: false, error: 'Validation failed' };
  }
}

export async function POST(req: Request) {
  const startTime = performance.now();
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    const { initData, referralCode } = await req.json();

    if (!initData) {
      return NextResponse.json({ error: 'Missing initData' }, { status: 400 });
    }

    // Validate
    const validation = await validateTelegram(initData, process.env.TELEGRAM_BOT_TOKEN);
    if (!validation.valid) {
      console.error(`[${requestId}] Auth failed:`, validation.error);
      return NextResponse.json({ error: validation.error }, { status: 403 });
    }

    const tgUser = validation.user;
    if (!tgUser?.id) {
      return NextResponse.json({ error: 'Invalid user' }, { status: 400 });
    }

    const telegramId = tgUser.id.toString();
    const now = Date.now();

    // Get or Create User
    let user = await queryD1(
      'SELECT * FROM users WHERE telegram_id = ?',
      [telegramId]
    ).then(r => r[0]);

    if (!user) {
      // Create new user
      const id = crypto.randomUUID();
      const today = new Date(now).toISOString().split('T')[0];
      
      await executeD1(`
        INSERT INTO users (
          id, telegram_id, first_name, last_name, username,
          last_update_time, referred_by, completed_tasks,
          last_ad_watch_date, challenge_coins, energy, max_energy,
          coins, referrals_count, auto_bot_active_until, wallet_connected,
          total_taps, referrals_activated, referral_coins_earned
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(telegram_id) DO UPDATE SET
          first_name = excluded.first_name,
          last_name = excluded.last_name,
          username = excluded.username
      `, [
        id, telegramId, tgUser.first_name || '', tgUser.last_name || null,
        tgUser.username || null, now, referralCode || null, '[]',
        today, 0, 500, 500, 0, 0, 0, 0, 0, 0, 0
      ]);

      // Process referral for new user
      if (referralCode && referralCode !== telegramId) {
        await executeD1(`
          UPDATE users 
          SET referrals_count = referrals_count + 1 
          WHERE telegram_id = ?
        `, [referralCode]).catch(console.error);
      }

      user = await queryD1(
        'SELECT * FROM users WHERE telegram_id = ?',
        [telegramId]
      ).then(r => r[0]);
    }

    // Calculate current energy
    const timePassedSec = Math.floor((now - user.last_update_time) / 1000);
    const regenRate = user.max_energy / 1800;
    const recoveredEnergy = Math.floor(timePassedSec * regenRate);
    const currentEnergy = Math.min(user.max_energy, user.energy + recoveredEnergy);

    // Calculate auto-bot earnings
    let botEarnings = 0;
    if (user.auto_bot_active_until > user.last_update_time) {
      const activeEndTime = Math.min(now, user.auto_bot_active_until);
      const activeSeconds = Math.floor((activeEndTime - user.last_update_time) / 1000);
      botEarnings = Math.floor(activeSeconds * 0.5); // 0.5 coin/sec
      
      if (botEarnings > 0) {
        await executeD1(`
          UPDATE users SET 
            coins = coins + ?,
            challenge_coins = challenge_coins + ?,
            energy = ?,
            last_update_time = ?
          WHERE telegram_id = ?
        `, [botEarnings, botEarnings, currentEnergy, now, telegramId]);
        
        // Refresh user data
        user = await queryD1(
          'SELECT * FROM users WHERE telegram_id = ?',
          [telegramId]
        ).then(r => r[0]);
      }
    }

    // Reset daily ads if needed
    const today = new Date(now).toISOString().split('T')[0];
    if (user.last_ad_watch_date !== today) {
      await executeD1(`
        UPDATE users SET ads_watched_today = 0, last_ad_watch_date = ? 
        WHERE telegram_id = ?
      `, [today, telegramId]);
      user.ads_watched_today = 0;
      user.last_ad_watch_date = today;
    }

    const duration = Math.round(performance.now() - startTime);
    console.log(`[${requestId}] Auth success for ${telegramId} in ${duration}ms`);

    return NextResponse.json({
      success: true,
      user: {
        ...user,
        energy: currentEnergy, // Return calculated energy
        completed_tasks: JSON.parse(user.completed_tasks || '[]'),
        wallet_connected: Boolean(user.wallet_connected)
      },
      serverTime: now,
      botEarnings: botEarnings > 0 ? botEarnings : undefined
    });

  } catch (error) {
    console.error(`[${requestId}] Auth error:`, error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
