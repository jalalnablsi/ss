import { NextResponse } from 'next/server';
import { queryD1, executeD1 } from '@/lib/db';

// ... (نفس دوال التشفير hmacSha256, bufferToHex, validateTelegramWebAppData من الملف السابق) ...
async function hmacSha256(key: string | ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey('raw', typeof key === 'string' ? encoder.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
}
function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function validateTelegramWebAppData(initData: string): Promise<boolean> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return true;
  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    if (!hash) return false;
    urlParams.delete('hash');
    const keys = Array.from(urlParams.keys()).sort();
    let dataCheckString = keys.map(key => `${key}=${urlParams.get(key)}`).join('\n');
    const secretKeyBuffer = await hmacSha256('WebAppData', botToken);
    const calculatedHashBuffer = await hmacSha256(secretKeyBuffer, dataCheckString);
    return bufferToHex(calculatedHashBuffer) === hash;
  } catch (error) { return false; }
}

export async function POST(req: Request) {
  try {
    const { initData, referralCode } = await req.json();
    if (!initData) return NextResponse.json({ error: 'Missing initData' }, { status: 400 });

    const isValid = await validateTelegramWebAppData(initData);
    if (!isValid && process.env.TELEGRAM_BOT_TOKEN) {
      return NextResponse.json({ error: 'Invalid Telegram data' }, { status: 403 });
    }

    const urlParams = new URLSearchParams(initData);
    const userStr = urlParams.get('user');
    if (!userStr) return NextResponse.json({ error: 'No user data' }, { status: 400 });

    const tgUser = JSON.parse(userStr);
    const telegramId = tgUser.id.toString();
    const now = Date.now();
    const today = new Date().toISOString().split('T')[0];

    // التأكد من وجود عمود challenge_coins (Migration آمن)
    try {
      await executeD1('ALTER TABLE users ADD COLUMN challenge_coins INTEGER DEFAULT 0');
    } catch (e) { /* موجود */ }

    let user = (await queryD1('SELECT * FROM users WHERE telegram_id = ?', [telegramId]))[0];

    if (!user) {
      // إنشاء مستخدم جديد
      const id = crypto.randomUUID();
      await executeD1(`
        INSERT INTO users (id, telegram_id, first_name, last_name, username, last_update_time, referred_by, completed_tasks, last_ad_watch_date, challenge_coins, energy, max_energy)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [id, telegramId, tgUser.first_name||'', tgUser.last_name||null, tgUser.username||null, now, referralCode||null, '[]', today, 0, 500, 500]);

      if (referralCode && referralCode !== telegramId) {
        await executeD1('UPDATE users SET referrals_count = referrals_count + 1 WHERE telegram_id = ?', [referralCode]);
      }
      user = (await queryD1('SELECT * FROM users WHERE telegram_id = ?', [telegramId]))[0];
    } else {
      // تحديث سريع للمستخدم الحالي (Lazy Update للطاقة فقط عند الدخول)
      const timePassedSec = Math.floor((now - user.last_update_time) / 1000);
      const energyToRecover = Math.floor(timePassedSec * (user.max_energy / 1800));
      const newEnergy = Math.min(user.max_energy, user.energy + energyToRecover);
      
      // تحديث بسيط إذا تغيرت الطاقة أو اليوم
      if (newEnergy !== user.energy || user.last_ad_watch_date !== today) {
        await executeD1(`
          UPDATE users SET energy = ?, last_update_time = ?, last_ad_watch_date = CASE WHEN ? != last_ad_watch_date THEN ? ELSE last_ad_watch_date END, ads_watched_today = CASE WHEN ? != last_ad_watch_date THEN 0 ELSE ads_watched_today END
          WHERE telegram_id = ?
        `, [newEnergy, now, today, today, today, telegramId]);
        
        // جلب البيانات المحدثة
        user = (await queryD1('SELECT * FROM users WHERE telegram_id = ?', [telegramId]))[0];
      }
    }

    user.completed_tasks = JSON.parse(user.completed_tasks || '[]');
    return NextResponse.json({ user, serverTime: now });
  } catch (error) {
    console.error('Auth API Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
