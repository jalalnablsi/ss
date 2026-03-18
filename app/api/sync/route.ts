import { NextResponse } from 'next/server';
import { queryD1, executeD1 } from '@/lib/db';

// --- دوال مساعدة متوافقة مع Web Crypto & Edge ---

// توليد UUID بدون الاعتماد على Node.js crypto
function generateUUID(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  array[6] = (array[6] & 0x0f) | 0x40;
  array[8] = (array[8] & 0x3f) | 0x80;
  const hex = Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function hmacSha256(key: string | ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', typeof key === 'string' ? encoder.encode(key) : key,
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
}

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function validateTelegram(initData: string): Promise<boolean> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return false;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    params.delete('hash');
    const dataCheckString = Array.from(params.keys()).sort().map(k => `${k}=${params.get(k)}`).join('\n');
    const secretKey = await hmacSha256('WebAppData', botToken);
    return bufferToHex(await hmacSha256(secretKey, dataCheckString)) === hash;
  } catch { return false; }
}

export async function POST(req: Request) {
  try {
    const { initData, tapCount, adWatchedType } = await req.json();

    // 1. التحقق الأمني
    if (!initData || !(await validateTelegram(initData))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const tgUser = JSON.parse(new URLSearchParams(initData).get('user') || '{}');
    const telegramId = tgUser.id?.toString();
    if (!telegramId) return NextResponse.json({ error: 'Invalid User' }, { status: 400 });

    const now = Date.now();
    const todayStr = new Date().toISOString().split('T')[0];

    // 2. جلب البيانات الأساسية
    const users = await queryD1('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
    const user = users[0];
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    // 3. الحسابات الذكية (Anti-Cheat & Energy)
    const timePassedSec = Math.floor((now - user.last_update_time) / 1000);
    const energyRegen = Math.floor(timePassedSec * (user.max_energy / 1800));
    let currentEnergy = Math.min(user.max_energy, user.energy + energyRegen);
    
    let addedCoins = 0;
    let addedTaps = 0;
    let newTotalTaps = user.total_taps;

    if (tapCount && tapCount > 0) {
      // حد بشري واقعي: 20 لمسة/ثانية + هامش شبكة
      const maxAllowed = (timePassedSec * 20) + 20; 
      const validTaps = Math.min(tapCount, maxAllowed, Math.floor(currentEnergy));
      
      if (validTaps > 0) {
        const multiplier = (user.tap_multiplier_end_time > now) ? user.tap_multiplier : 1;
        addedCoins = validTaps * multiplier;
        addedTaps = validTaps;
        newTotalTaps += validTaps;
        currentEnergy -= validTaps;
      }
    }

    // 4. معالجة الإعلانات والمكافآت
    let adBonus = 0;
    let newAdsWatchedToday = user.ads_watched_today;
    let newLastAdWatchDate = user.last_ad_watch_date;
    let newMultiplierEnd = user.tap_multiplier_end_time;
    let newBotEnd = user.auto_bot_active_until;

    if (adWatchedType) {
      // إعادة تعيين العداد اليومي إذا تغير اليوم
      if (newLastAdWatchDate !== todayStr) {
        newAdsWatchedToday = 0;
      }

      // التحقق من الحدود (يومي وساعي)
      if (newAdsWatchedToday < 30) {
        const oneHourAgo = new Date(now - 3600000).toISOString();
        const recentAds = await queryD1('SELECT COUNT(*) as c FROM ad_watches WHERE telegram_id = ? AND watched_at >= ?', [telegramId, oneHourAgo]);
        const adsLastHour = recentAds[0]?.c || 0;

        if (adsLastHour < 5) {
          // تسجيل الإعلان
          await executeD1('INSERT INTO ad_watches (id, telegram_id, watched_at) VALUES (?, ?, ?)', [
            generateUUID(), telegramId, new Date(now).toISOString()
          ]);

          adBonus = 1000;
          newAdsWatchedToday += 1;
          newLastAdWatchDate = todayStr;

          // تطبيق تأثيرات أنواع الإعلانات
          if (adWatchedType === 'multiplier') {
            newMultiplierEnd = now + 300000; // 5 دقائق من الآن
          } else if (adWatchedType === 'energy') {
            currentEnergy = user.max_energy;
          } else if (adWatchedType === 'bot') {
            newBotEnd = now + 21600000; // 6 ساعات من الآن
          }
        }
      }
    }

    const totalCoinsToAdd = addedCoins + adBonus;

    // 5. مكافأة الإحالة (مرة واحدة عند عبور حاجز 500)
    if (newTotalTaps >= 500 && user.total_taps < 500 && user.referred_by) {
      await executeD1(`
        UPDATE users 
        SET coins = coins + 1500, challenge_coins = COALESCE(challenge_coins, 0) + 1500, referrals_activated = referrals_activated + 1
        WHERE telegram_id = ?
      `, [user.referred_by]);
    }

    // 6. الحفظ التراكمي (Atomic Update)
    await executeD1(`
      UPDATE users SET 
        coins = coins + ?, 
        challenge_coins = COALESCE(challenge_coins, 0) + ?,
        total_taps = ?,
        energy = ?,
        last_update_time = ?,
        tap_multiplier_end_time = ?,
        auto_bot_active_until = ?,
        ads_watched_today = ?,
        last_ad_watch_date = ?
      WHERE telegram_id = ?
    `, [
      totalCoinsToAdd, 
      totalCoinsToAdd, 
      newTotalTaps,
      Math.floor(currentEnergy), 
      now,
      newMultiplierEnd,
      newBotEnd,
      newAdsWatchedToday,
      newLastAdWatchDate,
      telegramId
    ]);

    // جلب البيانات النهائية
    const finalUser = (await queryD1('SELECT * FROM users WHERE telegram_id = ?', [telegramId]))[0];

    return NextResponse.json({
      user: { ...finalUser, completed_tasks: JSON.parse(finalUser.completed_tasks || '[]') },
      serverTime: now
    });

  } catch (error) {
    console.error('Final Sync Error:', error);
    return NextResponse.json({ error: 'Internal Error' }, { status: 500 });
  }
}
