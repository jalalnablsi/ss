export const runtime = 'edge';
// app/api/sync/route.ts
// تم إزالة: export const runtime = 'edge'; 
// السبب: لضمان استقرار عمليات قاعدة البيانات D1 ومنع تضارب التحديثات (Race Conditions)

import { NextResponse } from 'next/server';

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

    // متغيرات محلية للحساب
    let newCoins = user.coins;
    let newChallengeCoins = user.challenge_coins || 0;
    let newTotalTaps = user.total_taps;
    
    // حسابات الوقت والطاقة
    const timePassedMs = now - user.last_update_time;
    const timePassedSec = Math.floor(timePassedMs / 1000);
    
    // معدل استعادة الطاقة (كاملة كل 30 دقيقة = 1800 ثانية)
    const energyRegenRate = user.max_energy / 1800; 
    const recoveredEnergy = Math.floor(timePassedSec * energyRegenRate);
    
    // الطاقة الحالية المتاحة (المخزنة + المستعادة حديثاً - مع سقف أقصى)
    // هذه المعادلة هي سر حل مشكلة "الطاقة التي تصفر فجأة"
    let currentEnergyPool = Math.min(user.max_energy, user.energy + recoveredEnergy);

    // حساب المضاعف الحالي
    const multiplier = user.tap_multiplier_end_time > now ? user.tap_multiplier : 1;

    // متغيرات الإعلانات
    let newAdsWatchedToday = user.ads_watched_today;
    let newLastAdWatchDate = user.last_ad_watch_date;
    let newTapMultiplierEndTime = user.tap_multiplier_end_time;
    let newAutoBotActiveUntil = user.auto_bot_active_until;

    // 3. Process Taps (Server-Side Validation - Optimized)
    if (taps && Array.isArray(taps) && taps.length > 0) {
      const reportedTapsCount = taps.length;

      // الحماية: الحد الأقصى المسموح به = (الثواني المنقضية * 15 لمسة) + هامش 10 للشبكة
      const maxAllowedTaps = (timePassedSec * 15) + 10; 

      // نأخذ أقل رقم بين: المرسل، المسموح به زمنياً، والطاقة المتاحة
      const validTapsCount = Math.min(reportedTapsCount, maxAllowedTaps, Math.floor(currentEnergyPool));

      if (validTapsCount > 0) {
        newTotalTaps += validTapsCount;
        currentEnergyPool -= validTapsCount; // خصم الطاقة من المجموعة المحلية
        
        const earnedCoins = validTapsCount * multiplier;
        newCoins += earnedCoins;
        newChallengeCoins += earnedCoins;
      }
      // اللمسات الزائدة تُهمل بصمت (Anti-Cheat)
    }

    // 4. Process Ad Rewards
    if (adWatchedType) {
      const today = new Date().toISOString().split('T')[0];
      
      if (newLastAdWatchDate !== today) {
        newAdsWatchedToday = 0;
      }

      if (newAdsWatchedToday < 30) {
        const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();
        const recentAds = await queryD1('SELECT COUNT(*) as count FROM ad_watches WHERE telegram_id = ? AND watched_at >= ?', [telegramId, oneHourAgo]);
        const adsLastHour = recentAds[0]?.count || 0;

        if (adsLastHour < 5) {
          const lastAds = await queryD1('SELECT watched_at FROM ad_watches WHERE telegram_id = ? ORDER BY watched_at DESC LIMIT 1', [telegramId]);
          const lastAd = lastAds[0];
          let canWatch = true;

          if (lastAd) {
            const lastAdTime = new Date(lastAd.watched_at).getTime();
            const timeSinceLastAd = now - lastAdTime;
            const requiredCooldown = adsLastHour * 30 * 1000; 
            
            if (timeSinceLastAd < requiredCooldown) {
              canWatch = false;
            }
          }

          if (canWatch) {
            await executeD1('INSERT INTO ad_watches (id, telegram_id, watched_at) VALUES (?, ?, ?)', [
              crypto.randomUUID(), telegramId, new Date(now).toISOString()
            ]);

            newAdsWatchedToday += 1;
            newLastAdWatchDate = today;

            newCoins += 1000;
            newChallengeCoins += 1000;
            
            if (adWatchedType === 'multiplier') {
              newTapMultiplierEndTime = now + 5 * 60 * 1000;
            } else if (adWatchedType === 'energy') {
              currentEnergyPool = user.max_energy; // تعبئة فورية
            } else if (adWatchedType === 'bot') {
              newAutoBotActiveUntil = now + 6 * 60 * 60 * 1000;
            }
          }
        }
      }
    }

    // 4.5 Handle Referrals (First time reaching 500 taps)
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
        }
      } catch (e) {
        console.error('Failed to process referral reward:', e);
      }
    }

    // 5. Save to Database (Single Atomic Update)
    await executeD1(`
      UPDATE users SET 
        coins = ?, 
        challenge_coins = ?, 
        energy = ?, 
        total_taps = ?, 
        tap_multiplier_end_time = ?, 
        auto_bot_active_until = ?, 
        ads_watched_today = ?, 
        last_ad_watch_date = ?, 
        last_update_time = ?
      WHERE telegram_id = ?
    `, [
      newCoins, 
      newChallengeCoins, 
      Math.floor(currentEnergyPool), 
      newTotalTaps,
      newTapMultiplierEndTime,
      newAutoBotActiveUntil,
      newAdsWatchedToday,
      newLastAdWatchDate,
      now,
      telegramId
    ]);

    // Fetch updated user data
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
