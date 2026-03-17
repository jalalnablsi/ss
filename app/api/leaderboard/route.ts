export const runtime = 'edge';
import { NextResponse } from 'next/server';
import { queryD1 } from '@/lib/db';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const period = searchParams.get('period') || 'all_time';

  try {
    let orderByColumn = 'coins';
    
    if (period === 'challenge') {
      orderByColumn = 'challenge_coins';
    }

    const data = await queryD1(`
      SELECT telegram_id, first_name, last_name, username, coins, challenge_coins 
      FROM users 
      ORDER BY ${orderByColumn} DESC 
      LIMIT 50
    `);

    // Format the data for the frontend
    const leaderboard = data.map((user: any, index: number) => ({
      id: user.telegram_id,
      name: user.first_name || user.username || `User_${user.telegram_id.substring(0, 4)}`,
      coins: period === 'challenge' ? (user.challenge_coins || 0) : user.coins,
      rank: index + 1,
    }));

    // Fetch active challenge info
    let activeChallenge = null;
    try {
      const challenges = await queryD1('SELECT * FROM challenges WHERE is_active = 1 ORDER BY start_time DESC LIMIT 1');
      activeChallenge = challenges[0] || null;
    } catch (e) {
      // Ignore if table doesn't exist yet
    }

    return NextResponse.json({ leaderboard, activeChallenge });
  } catch (error) {
    console.error('Leaderboard API Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
