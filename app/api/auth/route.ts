import { NextResponse } from 'next/server';
import { queryD1, executeD1 } from '@/lib/db';

// --- دوال التشفير (نفسها تماماً كما تعمل) ---
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

async function validateTelegramWebAppData(initData: string): Promise<boolean> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  
  // إذا لم يوجد توكن، نمرر التحقق (للتطوير)
  if (!botToken) {
    console.warn('[AUTH] Missing BOT_TOKEN, skipping validation.');
    return true;
  }

  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    if (!hash) return false;

    urlParams.delete('hash');
    
    // ترتيب المفاتيح أبجدياً (ضروري جداً)
    const keys = Array.from(urlParams.keys()).sort();
    let dataCheckString = '';
    for (const key of keys) {
      dataCheckString += `${key}=${urlParams.get(key)}\n`;
    }
    // إزالة السطر الأخير (Newline)
    dataCheckString = dataCheckString.slice(0, -1);

    const secretKeyBuffer = await hmacSha256('WebAppData', botToken);
    const calculatedHashBuffer = await hmacSha256(secretKeyBuffer, dataCheckString);
    const calculatedHash = bufferToHex(calculatedHashBuffer);

    const isValid = calculatedHash === hash;
    if (!isValid) {
      console.error('[AUTH] Hash Mismatch!', {
        received: hash,
        calculated: calculatedHash,
        // لا تطبع البيانات الكاملة لحماية الخصوصية
        dataLength: dataCheckString.length
      });
    }
    return isValid;
  } catch (error) {
    console.error('[AUTH] Validation Exception:', error);
    return false;
  }
}

export async function POST(req: Request) {
  // 1. قراءة الجسم بطريقة تقليدية مضمونة
  let body;
  try {
    body = await req.json();
  } catch (e) {
    console.error('[AUTH] Failed to parse JSON:', e);
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { initData, referralCode } = body;

  if (!initData) {
    console.error('[AUTH] No initData provided');
    return NextResponse.json({ error: 'Missing initData' }, { status: 400 });
  }

  console.log('[AUTH] Received request. initData length:', initData.length);

  // 2. التحقق
  const isValid = await validateTelegramWebAppData(initData);
  
  // إذا كان التوكن موجوداً والتحقق فشل
  if (!isValid && process.env.TELEGRAM_BOT_TOKEN) {
    console.error('[AUTH] Access Denied: Invalid Signature');
    return NextResponse.json({ error: 'Invalid Telegram data' }, { status: 403 });
  }

  // 3. استخراج بيانات المستخدم
  const urlParams = new URLSearchParams(initData);
  const userStr = urlParams.get('user');
  
  if (!userStr) {
    console.error('[AUTH] No user object in initData');
    return NextResponse.json({ error: 'No user data' }, { status: 400 });
  }

  let tgUser;
  try {
    tgUser = JSON.parse(userStr);
  } catch (e) {
    console.error('[AUTH] Failed to parse user JSON', e);
    return NextResponse.json({ error: 'Invalid user format' }, { status: 400 });
  }

  const telegramId = tgUser.id.toString();
  const now = Date.now();
  const today = new Date().toISOString().split('T')[0];

  console.log('[AUTH] User validated:', telegramId);

  // 4. التأكد من وجود الأعمدة (Migration)
  try {
    await executeD1('ALTER TABLE users ADD COLUMN challenge_coins INTEGER DEFAULT 0');
  } catch (e) { /* تجاهل إذا وجد */ }

  // 5. جلب أو إنشاء المستخدم
  let user = (await queryD1('SELECT * FROM users WHERE telegram_id = ?', [telegramId]))[0];

  if (!user) {
    console.log('[AUTH] Creating new user:', telegramId);
    const id = crypto.randomUUID();
    
    await executeD1(`
      INSERT INTO users (id, telegram_id, first_name, last_name, username, last_update_time, referred_by, completed_tasks, last_ad_watch_date, challenge_coins, energy, max_energy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, telegramId, tgUser.first_name || '', tgUser.last_name || null, tgUser.username || null,
      now, referralCode || null, '[]', today, 0, 500, 500
    ]);

    if (referralCode && referralCode !== telegramId) {
      await executeD1('UPDATE users SET referrals_count = referrals_count + 1 WHERE telegram_id = ?', [referralCode]);
    }

    user = (await queryD1('SELECT * FROM users WHERE telegram_id = ?', [telegramId]))[0];
  } else {
    // تحديث الطاقة والوقت (Lazy Load)
    const timePassedSec = Math.floor((now - user.last_update_time) / 1000);
    const energyToRecover = Math.floor(timePassedSec * (user.max_energy / 1800));
    const newEnergy = Math.min(user.max_energy, user.energy + energyToRecover);
    
    let needsUpdate = false;
    if (newEnergy !== user.energy) needsUpdate = true;
    if (user.last_ad_watch_date !== today) needsUpdate = true;

    if (needsUpdate) {
      await executeD1(`
        UPDATE users SET 
          energy = ?, 
          last_update_time = ?, 
          last_ad_watch_date = CASE WHEN ? != last_ad_watch_date THEN ? ELSE last_ad_watch_date END, 
          ads_watched_today = CASE WHEN ? != last_ad_watch_date THEN 0 ELSE ads_watched_today END
        WHERE telegram_id = ?
      `, [newEnergy, now, today, today, today, telegramId]);
      
      // إعادة الجلب للحصول على القيم المحدثة
      user = (await queryD1('SELECT * FROM users WHERE telegram_id = ?', [telegramId]))[0];
    }
  }

  user.completed_tasks = JSON.parse(user.completed_tasks || '[]');

  return NextResponse.json({ user, serverTime: now });
}
