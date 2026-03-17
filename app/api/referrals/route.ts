export const runtime = 'edge'; // تأكد من إضافة هذا السطر
import { NextResponse } from 'next/server';
import { queryD1 } from '@/lib/db';

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

// --- دالة التحقق المعدلة (Async) ---

async function validateTelegramWebAppData(initData: string): Promise<boolean> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return false;
  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    if (!hash) return false;
    urlParams.delete('hash');
    
    const keys = Array.from(urlParams.keys()).sort();
    let dataCheckString = '';
    for (const key of keys) dataCheckString += `${key}=${urlParams.get(key)}\n`;
    dataCheckString = dataCheckString.slice(0, -1);

    // استخدام Web Crypto API بدلاً من createHmac
    const secretKeyBuffer = await hmacSha256('WebAppData', botToken);
    const calculatedHashBuffer = await hmacSha256(secretKeyBuffer, dataCheckString);
    const calculatedHash = bufferToHex(calculatedHashBuffer);

    return calculatedHash === hash;
  } catch { return false; }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const initData = searchParams.get('initData');

    if (!initData) return NextResponse.json({ error: 'Missing initData' }, { status: 400 });
    
    // أضف await هنا لأن الدالة أصبحت async
    const isValid = await validateTelegramWebAppData(initData);
    if (!isValid) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

    const urlParams = new URLSearchParams(initData);
    const tgUser = JSON.parse(urlParams.get('user') || '{}');
    const telegramId = tgUser.id?.toString();
    
    if (!telegramId) return NextResponse.json({ error: 'Invalid user in initData' }, { status: 400 });

    // 1. جلب بيانات المستخدم الحالي
    const users = await queryD1('SELECT referrals_count, referral_coins_earned, referrals_activated FROM users WHERE telegram_id = ?', [telegramId]);
    const user = users[0];
    
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    // 2. جلب قائمة الأشخاص الذين قام بدعوتهم
    const referrals = await queryD1(`
      SELECT telegram_id, first_name, username, coins, total_taps 
      FROM users 
      WHERE referred_by = ? 
      ORDER BY created_at DESC 
      LIMIT 50
    `, [telegramId]);

    const formattedReferrals = referrals.map((r: any) => ({
      id: r.telegram_id,
      name: r.first_name || r.username || `User_${r.telegram_id.substring(0,4)}`,
      coins: r.coins,
      taps: r.total_taps,
      rewardClaimed: (r.total_taps || 0) >= 500 
    }));

    return NextResponse.json({
      myStats: {
        totalReferrals: user.referrals_count || 0,
        earnedCoins: user.referral_coins_earned || 0,
        activatedCount: user.referrals_activated || 0
      },
      referrals: formattedReferrals
    });

  } catch (error) {
    console.error('Referrals API Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
