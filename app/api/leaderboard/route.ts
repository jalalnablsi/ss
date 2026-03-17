
import { NextResponse } from 'next/server';
import { queryD1 } from '@/lib/db';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const period = searchParams.get('period') || 'all_time';

  try {
    let orderByColumn = 'coins';
    let activeChallenge = null;

    // جلب معلومات التحدي النشط أولاً
    try {
      const challenges = await queryD1('SELECT * FROM challenges WHERE is_active = 1 ORDER BY start_time DESC LIMIT 1');
      activeChallenge = challenges[0] || null;
    } catch (e) {
      // الجدول غير موجود بعد
    }

    if (period === 'challenge') {
      // إذا كان الطلب للتحدي ولا يوجد تحدي نشط، نعيد قائمة فارغة فوراً
      if (!activeChallenge) {
        return NextResponse.json({ 
          leaderboard: [], 
          activeChallenge: null,
          message: 'No active challenge' 
        });
      }
      orderByColumn = 'challenge_coins';
    }

    // استعلام آمن排序
    // ملاحظة: نستخدم ORDER BY مباشر لأن القيم تأتي من متغير موثوق داخلياً
    const data = await queryD1(`
      SELECT telegram_id, first_name, last_name, username, coins, challenge_coins 
      FROM users 
      ORDER BY ${orderByColumn} DESC 
      LIMIT 50
    `);

    const leaderboard = data.map((user: any, index: number) => ({
      id: user.telegram_id,
      name: user.first_name || user.username || `User_${user.telegram_id.substring(0, 4)}`,
      coins: period === 'challenge' ? (user.challenge_coins || 0) : user.coins,
      rank: index + 1,
    }));

    return NextResponse.json({ leaderboard, activeChallenge });
  } catch (error) {
    console.error('Leaderboard API Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
