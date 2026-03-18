import { NextResponse } from 'next/server';
import { queryD1, executeD1 } from '@/lib/db';

// --- دوال التشفير (نفسها كما هي) ---
async function hmacSha256(key: string | ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey('raw', typeof key === 'string' ? encoder.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
}
function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function validateTelegram(initData: string): Promise<boolean> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return true; // للتطوير المحلي
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

    // 2. جلب المستخدم (Query واحدة فقط)
    const users = await queryD1('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
    const user = users[0];
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    // 3. الحسابات الذكية (Lazy Calculation) - لا نحدث الطاقة في DB إلا عند الضرورة القصوى
    const timePassedSec = Math.floor((now - user.last_update_time) / 1000);
    
    // حساب الطاقة الحالية رياضياً دون كتابة في DB
    const energyRegenRate = user.max_energy / 1800; // طاقة كاملة في 30 دقيقة
    const recoveredEnergy = Math.floor(timePassedSec * energyRegenRate);
    let currentEnergy = Math.min(user.max_energy, user.energy + recoveredEnergy);

    let coinsToAdd = 0;
    let tapsProcessed = 0;
    let finalMultiplier = 1;

    // 4. معالجة الضغطات
    if (tapCount && tapCount > 0) {
      // التحقق من المضاعف
      if (user.tap_multiplier_end_time > now) {
        finalMultiplier = user.tap_multiplier; // ستكون 4 إذا عدلناها لاحقاً
      }

      // Anti-Cheat مرن: نسمح بهامش زمني للشبكة (5 ثواني إضافية)
      const maxAllowedTaps = (timePassedSec * 15) + 10; 
      const validTaps = Math.min(tapCount, maxAllowedTaps, Math.floor(currentEnergy));

      if (validTaps > 0) {
        coinsToAdd = validTaps * finalMultiplier;
        tapsProcessed = validTaps;
        currentEnergy -= validTaps; // خصم الطاقة محلياً للحساب الحالي
      }
    }

    // 5. معالجة الإعلانات والمكافآت
    let adBonus = 0;
    let newAdsWatchedToday = user.ads_watched_today;
    let newLastAdWatchDate = user.last_ad_watch_date;
    let newMultiplierEnd = user.tap_multiplier_end_time;
    let newMultiplierVal = user.tap_multiplier;
    let newBotEnd = user.auto_bot_active_until;
    let shouldResetDailyAds = false;

    if (newLastAdWatchDate !== todayStr) {
      shouldResetDailyAds = true;
      newAdsWatchedToday = 0;
      newLastAdWatchDate = todayStr;
    }

    if (adWatchedType) {
      // حدود الإعلانات
      if (newAdsWatchedToday < 30) {
        const oneHourAgo = new Date(now - 3600000).toISOString();
        const recentAds = await queryD1('SELECT COUNT(*) as c FROM ad_watches WHERE telegram_id = ? AND watched_at >= ?', [telegramId, oneHourAgo]);
        const adsLastHour = recentAds[0]?.c || 0;

        if (adsLastHour < 5) {
          // تسجيل الإعلان
          await executeD1('INSERT INTO ad_watches (id, telegram_id, watched_at) VALUES (?, ?, ?)', [
            crypto.randomUUID(), telegramId, new Date(now).toISOString()
          ]);

          adBonus = 1000;
          newAdsWatchedToday += 1;

          if (adWatchedType === 'multiplier') {
            // هنا نضع المضاعف 4 بدلاً من 2
            newMultiplierVal = 4; 
            newMultiplierEnd = now + 300000; // 5 دقائق
          } else if (adWatchedType === 'energy') {
            currentEnergy = user.max_energy;
          } else if (adWatchedType === 'bot') {
            newBotEnd = now + 21600000;
          }
        }
      }
    }

    // 6. مكافأة الإحالة (Fix Logic)
    // نتحقق مما إذا كان المستخدم قد تجاوز 500 ضغطة الآن ولم يكن قد تجاوزها سابقاً
    const oldTotalTaps = user.total_taps || 0;
    const potentialNewTotal = oldTotalTaps + tapsProcessed;
    
    if (potentialNewTotal >= 500 && oldTotalTaps < 500 && user.referred_by) {
      // تحديث المُحيل فوراً
      await executeD1(`
        UPDATE users 
        SET coins = coins + 1500, 
            challenge_coins = COALESCE(challenge_coins, 0) + 1500, 
            referrals_activated = referrals_activated + 1 
        WHERE telegram_id = ?
      `, [user.referred_by]);
    }

    // 7. الحفظ النهائي في قاعدة البيانات (Update واحد فقط)
    // نحدث last_update_time لنقطة "الآن"، والطاقة المتبقية بعد الخصم
    await executeD1(`
      UPDATE users SET 
        coins = coins + ?, 
        challenge_coins = COALESCE(challenge_coins, 0) + ?,
        total_taps = total_taps + ?,
        energy = ?, 
        last_update_time = ?,
        tap_multiplier = ?,
        tap_multiplier_end_time = ?,
        auto_bot_active_until = ?,
        ads_watched_today = ?,
        last_ad_watch_date = ?
      WHERE telegram_id = ?
    `, [
      coinsToAdd + adBonus, 
      coinsToAdd + adBonus, 
      tapsProcessed,
      Math.floor(currentEnergy), 
      now,
      newMultiplierVal,
      newMultiplierEnd,
      newBotEnd,
      newAdsWatchedToday,
      newLastAdWatchDate,
      telegramId
    ]);

    // جلب البيانات المحدثة لإرجاعها (يمكن تحسينها بحسابها يدوياً لتوفير Query، لكن للأمان نجلبها)
    const finalUserList = await queryD1('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
    const finalUser = finalUserList[0];

    return NextResponse.json({
      user: { ...finalUser, completed_tasks: JSON.parse(finalUser.completed_tasks || '[]') },
      serverTime: now,
      debug: { addedCoins: coinsToAdd + adBonus, energyLeft: Math.floor(currentEnergy) }
    });

  } catch (error) {
    console.error('Sync API Critical Error:', error);
    return NextResponse.json({ error: 'Internal Error', details: String(error) }, { status: 500 });
  }
}
