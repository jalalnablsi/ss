export const runtime = 'edge';
import { NextResponse } from 'next/server';

import { queryD1, executeD1 } from '@/lib/db';

// Helper to validate Telegram initData
function validateTelegramWebAppData(initData: string): boolean {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.warn('TELEGRAM_BOT_TOKEN is missing. Skipping validation for development.');
    return false;
  }

  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    if (!hash) return false;

    urlParams.delete('hash');
    
    // Sort keys alphabetically
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

export async function POST(req: Request) {
  try {
    const { initData, referralCode } = await req.json();

    if (!initData) {
      return NextResponse.json({ error: 'Missing initData' }, { status: 400 });
    }

    // 1. Validate Telegram Data
    const isValid = validateTelegramWebAppData(initData);
    
    // If validation fails, we block access (Production Mode)
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
    const today = new Date().toISOString().split('T')[0];

    // Ensure challenge_coins column exists if it doesn't (migration)
    try {
      await executeD1('ALTER TABLE users ADD COLUMN challenge_coins INTEGER DEFAULT 0');
    } catch (e) {
      // Ignore if already exists
    }

    // 2. Fetch User from D1
    const users = await queryD1('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
    let user = users[0];

    // 3. Create User if Not Exists
    if (!user) {
      const id = crypto.randomUUID();
      const completedTasks = JSON.stringify([]);
      
      await executeD1(`
        INSERT INTO users (
          id, telegram_id, first_name, last_name, username, 
          last_update_time, referred_by, completed_tasks, last_ad_watch_date, challenge_coins
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        id, telegramId, tgUser.first_name || '', tgUser.last_name || null, tgUser.username || null,
        now, referralCode || null, completedTasks, today, 0
      ]);

      // Handle Referral Logic
      if (referralCode && referralCode !== telegramId) {
        await executeD1('UPDATE users SET referrals_count = referrals_count + 1 WHERE telegram_id = ?', [referralCode]);
      }

      const newUsers = await queryD1('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
      user = newUsers[0];
    } else {
      // 4. Calculate Offline Earnings & Energy Regeneration (Server-Side Anti-Cheat)
      let updates: any = {};
      let needsUpdate = false;

      // Reset daily ads
      if (user.last_ad_watch_date !== today) {
        updates.ads_watched_today = 0;
        updates.last_ad_watch_date = today;
        needsUpdate = true;
      }

      const timePassedMs = now - user.last_update_time;
      const timePassedSec = Math.floor(timePassedMs / 1000);

      // Energy Regeneration (500 energy per 30 mins = ~0.277 per sec)
      if (user.energy < user.max_energy) {
        const energyToRecover = Math.floor(timePassedSec * (user.max_energy / 1800));
        const newEnergy = Math.min(user.max_energy, user.energy + energyToRecover);
        if (newEnergy !== user.energy) {
          updates.energy = newEnergy;
          needsUpdate = true;
        }
      }

      // Auto-Bot Offline Earnings
      if (user.auto_bot_active_until > user.last_update_time) {
        const botActiveTimeMs = Math.min(now, user.auto_bot_active_until) - user.last_update_time;
        const botActiveTimeSec = Math.floor(botActiveTimeMs / 1000);
        if (botActiveTimeSec > 0) {
          const earnedCoins = Math.floor(botActiveTimeSec * 0.5); // 0.5 coins per sec
          updates.coins = user.coins + earnedCoins;
          updates.challenge_coins = (user.challenge_coins || 0) + earnedCoins;
          needsUpdate = true;
        }
      }

      if (needsUpdate) {
        updates.last_update_time = now;
        
        const setClauses = [];
        const values = [];
        for (const [key, value] of Object.entries(updates)) {
          setClauses.push(`${key} = ?`);
          values.push(value);
        }
        values.push(telegramId);

        await executeD1(`UPDATE users SET ${setClauses.join(', ')} WHERE telegram_id = ?`, values);

        const updatedUsers = await queryD1('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
        user = updatedUsers[0];
      }
    }

    // Parse JSON fields and convert booleans
    user.completed_tasks = JSON.parse(user.completed_tasks || '[]');
    user.wallet_connected = Boolean(user.wallet_connected);

    return NextResponse.json({ user, serverTime: now });
  } catch (error) {
    console.error('Auth API Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
