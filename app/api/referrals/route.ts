import { NextResponse } from 'next/server';
import { queryD1 } from '@/lib/db';


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
    for (const key of keys) dataCheckString += `${key}=${urlParams.get(key)}\n`;
    dataCheckString = dataCheckString.slice(0, -1);
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    return calculatedHash === hash;
  } catch { return false; }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const initData = searchParams.get('initData');

    if (!initData) return NextResponse.json({ error: 'Missing initData' }, { status: 400 });
    if (!validateTelegramWebAppData(initData)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

    const urlParams = new URLSearchParams(initData);
    const tgUser = JSON.parse(urlParams.get('user') || '{}');
    const telegramId = tgUser.id.toString();

    // 1. جلب بيانات المستخدم الحالي (لرصد عدد المدعوين والمكافآت)
    const users = await queryD1('SELECT referrals_count, referral_coins_earned, referrals_activated FROM users WHERE telegram_id = ?', [telegramId]);
    const user = users[0];
    
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    // 2. جلب قائمة الأشخاص الذين قام بدعوتهم (آخر 50 شخصاً)
    const referrals = await queryD1(`
      SELECT telegram_id, first_name, username, coins, total_taps 
      FROM users 
      WHERE referred_by = ? 
      ORDER BY created_at DESC 
      LIMIT 50
    `, [telegramId]);

    const formattedReferrals = referrals.map((r: any) => ({
      id: r.telegram_id,
      name: r.first_name || r.username || `User_${r.telegram_id.slice(0,4)}`,
      coins: r.coins,
      taps: r.total_taps,
      // حالة المكافأة: إذا كان total_taps >= 500 وتم احتساب المكافأة
      rewardClaimed: r.total_taps >= 500 
    }));

    return NextResponse.json({
      myStats: {
        totalReferrals: user.referrals_count,
        earnedCoins: user.referral_coins_earned,
        activatedCount: user.referrals_activated // عدد من تجاوزوا 500 لمسة
      },
      referrals: formattedReferrals
    });

  } catch (error) {
    console.error('Referrals API Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
