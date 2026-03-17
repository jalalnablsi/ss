export const runtime = 'edge';
import { NextResponse } from 'next/server';
import { queryD1, executeD1 } from '@/lib/db';

// --- دوال التشفير المتوافقة مع Edge Runtime ---

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

// --- دالة التحقق من بيانات تليجرام (Async) ---

async function validateTelegramWebAppData(initData: string): Promise<boolean> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return false;

  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    if (!hash) return false;

    urlParams.delete('hash');
    const keys = Array.from(urlParams.keys()).sort();
    let dataCheckString = keys.map(key => `${key}=${urlParams.get(key)}`).join('\n');

    const secretKey = await hmacSha256('WebAppData', botToken);
    const calculatedHashBuffer = await hmacSha256(secretKey, dataCheckString);
    const calculatedHash = bufferToHex(calculatedHashBuffer);

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

    // 1. التحقق من البيانات (Anti-Bot) - استخدام await
    const isValid = await validateTelegramWebAppData(initData);
    if (!isValid && process.env.TELEGRAM_BOT_TOKEN) {
      return NextResponse.json({ error: 'Invalid Telegram data.' }, { status: 403 });
    }

    const urlParams = new URLSearchParams(initData);
    const userStr = urlParams.get('user');
    if (!userStr) return NextResponse.json({ error: 'No user data' }, { status: 400 });

    const tgUser = JSON.parse(userStr);
    const telegramId = tgUser.id.toString();
    const now = Date.now();

    // 2. جلب المستخدم
    const users = await queryD1('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
    const user = users[0];
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    let {
      coins: newCoins, energy: newEnergy, total_taps: newTotalTaps,
      tap_multiplier: newTapMultiplier, tap_multiplier_end_time: newTapMultiplierEndTime,
      auto_bot_active_until: newAutoBotActiveUntil, ads_watched_today: newAdsWatchedToday,
      last_ad_watch_date: newLastAdWatchDate, referrals_activated: newReferralsActivated
    } = user;
    
    let newChallengeCoins = user.challenge_coins || 0;

    // 3. معالجة الضغطات (Anti-Cheat)
    if (taps && Array.isArray(taps) && taps.length > 0) {
      const secondsPassed = Math.floor((now - user.last_update_time) / 1000);
      const maxTapsAllowed = (secondsPassed * 15) + 15; 
      const tapsToProcess = Math.min(taps.length, maxTapsAllowed);

      for (let i = 0; i < tapsToProcess; i++) {
        if (newEnergy >= 1) {
          newEnergy -= 1;
          newTotalTaps += 1;
          const multiplier = newTapMultiplierEndTime > now ? newTapMultiplier : 1;
          newCoins += (1 * multiplier);
          newChallengeCoins += (1 * multiplier);
        }
      }
    }

    // 4. معالجة مكافآت الإعلانات
    if (adWatchedType) {
      const today = new Date().toISOString().split('T')[0];
      if (newLastAdWatchDate !== today) newAdsWatchedToday = 0;

      if (newAdsWatchedToday >= 30) return NextResponse.json({ error: 'Daily limit reached' }, { status: 429 });

      const oneHourAgo = new Date(now - 3600000).toISOString();
      const recentAds = await queryD1('SELECT COUNT(*) as count FROM ad_watches WHERE telegram_id = ? AND watched_at >= ?', [telegramId, oneHourAgo]);
      if ((recentAds[0]?.count || 0) >= 5) return NextResponse.json({ error: 'Hourly limit reached' }, { status: 429 });

      // تسجيل مشاهدة الإعلان - استخدام crypto.randomUUID() المدمج
      await executeD1('INSERT INTO ad_watches (id, telegram_id, watched_at) VALUES (?, ?, ?)', [
        crypto.randomUUID(), telegramId, new Date(now).toISOString()
      ]);

      newAdsWatchedToday += 1;
      newLastAdWatchDate = today;
      newCoins += 1000;
      newChallengeCoins += 1000;
      
      if (adWatchedType === 'multiplier') {
        newTapMultiplier = 2;
        newTapMultiplierEndTime = now + 300000; 
      } else if (adWatchedType === 'energy') {
        newEnergy = user.max_energy;
      } else if (adWatchedType === 'bot') {
        newAutoBotActiveUntil = now + 21600000; 
      }
    }

    // 5. معالجة الإحالات (عند الوصول لـ 500 ضغطة)
    if (newTotalTaps >= 500 && user.total_taps < 500 && user.referred_by) {
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

    // 6. الحفظ النهائي
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
