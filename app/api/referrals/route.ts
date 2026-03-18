import { queryD1 } from '@/lib/db';
import { validateTelegramWebAppData, parseInitData } from '@/lib/telegram';
import { NextRequest, NextResponse } from 'next/server';



export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const initData = searchParams.get('initData');

    if (!initData || !(await validateTelegramWebAppData(initData))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tgUser = parseInitData(initData);
    const userId = tgUser.id;

    // 1. جلب إحصائيات المستخدم (الإجمالي)
    const userStats = await queryD1(
      `SELECT referrals_count, coins FROM users WHERE id = ?`,
      [userId]
    );

    // 2. جلب قائمة الأصدقاء الذين سجلوا عن طريق هذا المستخدم
    // نفترض أن المكافأة 1500 كما في واجهتك
    const friends = await queryD1(
      `SELECT username as name, coins, id, 
       (SELECT COALESCE(SUM(taps_count), 0) FROM taps_log WHERE user_id = users.id) as taps
       FROM users 
       WHERE referred_by = ? 
       ORDER BY last_sync DESC`,
      [userId]
    );

    // ملاحظة: إذا لم يكن لديك جدول taps_log، يمكنك استخدام عمود coins مباشرة كتقدير
    const formattedFriends = friends.map(f => ({
      id: f.id,
      name: f.name || 'Anonymous',
      taps: f.taps || 0,
      coins: f.coins || 0
    }));

    return NextResponse.json({
      myStats: {
        totalReferrals: userStats[0]?.referrals_count || 0,
        earnedCoins: (userStats[0]?.referrals_count || 0) * 1500
      },
      referrals: formattedFriends
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
