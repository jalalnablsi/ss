// app/api/referrals/route.ts
import { NextResponse } from 'next/server';
import { queryD1, executeD1 } from '@/lib/db';
import { validateTelegramWebAppData, parseInitData } from '@/lib/telegram';

export async function GET(req: Request) {
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    const url = new URL(req.url);
    const initData = url.searchParams.get('initData');

    if (!initData) {
      return NextResponse.json(
        { error: 'Missing initData' },
        { status: 400 }
      );
    }

    // التحقق من صحة البيانات
    const isValid = await validateTelegramWebAppData(initData);
    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid Telegram data' },
        { status: 403 }
      );
    }

    const tgUser = parseInitData(initData);
    if (!tgUser?.id) {
      return NextResponse.json(
        { error: 'No user data' },
        { status: 400 }
      );
    }

    const telegramId = tgUser.id.toString();

    // جلب المستخدم
    const users = await queryD1(
      'SELECT * FROM users WHERE telegram_id = ?',
      [telegramId]
    );

    const user = users[0];
    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // جلب قائمة الإحالات
    const referrals = await queryD1(
      `SELECT 
        telegram_id,
        first_name,
        last_name,
        username,
        total_taps,
        coins,
        created_at,
        CASE 
          WHEN total_taps >= 500 THEN 1 
          ELSE 0 
        END as is_activated
      FROM users 
      WHERE referred_by = ?
      ORDER BY created_at DESC
      LIMIT 100`,
      [telegramId]
    );

    // إحصائيات الإحالات
    const stats = {
      total: user.referrals_count || 0,
      activated: user.referrals_activated || 0,
      pending: (user.referrals_count || 0) - (user.referrals_activated || 0),
      coinsEarned: user.referral_coins_earned || 0,
      nextRewardAt: 500, // كل 500 ضغطة
      currentProgress: referrals.map((r: any) => r.total_taps)
    };

    return NextResponse.json({
      success: true,
      referrals: referrals.map((r: any) => ({
        id: r.telegram_id,
        firstName: r.first_name,
        lastName: r.last_name,
        username: r.username,
        taps: r.total_taps,
        coins: r.coins,
        joinedAt: r.created_at,
        isActivated: Boolean(r.is_activated)
      })),
      stats,
      referralLink: `https://t.me/${process.env.BOT_USERNAME}?start=${telegramId}`,
      shareText: `🔥 Join me on TapCoin and start earning!\n\n💎 Get 1500 coins when your friend reaches 500 taps!\n\n🚀 Click here to start:`
    });

  } catch (error) {
    console.error(`[${requestId}] Referrals error:`, error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST للتحقق من حالة الإحالة
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { initData, referralCode } = body;

    if (!initData || !referralCode) {
      return NextResponse.json(
        { error: 'Missing parameters' },
        { status: 400 }
      );
    }

    const isValid = await validateTelegramWebAppData(initData);
    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid Telegram data' },
        { status: 403 }
      );
    }

    const tgUser = parseInitData(initData);
    if (!tgUser?.id) {
      return NextResponse.json(
        { error: 'No user data' },
        { status: 400 }
      );
    }

    const telegramId = tgUser.id.toString();

    // التحقق من صحة كود الإحالة
    const referrers = await queryD1(
      'SELECT telegram_id, first_name, username FROM users WHERE telegram_id = ?',
      [referralCode]
    );

    const referrer = referrers[0];
    if (!referrer) {
      return NextResponse.json(
        { error: 'Invalid referral code' },
        { status: 404 }
      );
    }

    // منع الإحالة الذاتية
    if (referrer.telegram_id === telegramId) {
      return NextResponse.json(
        { error: 'Cannot refer yourself' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      referrer: {
        id: referrer.telegram_id,
        name: referrer.first_name,
        username: referrer.username
      }
    });

  } catch (error) {
    console.error('Referral check error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
