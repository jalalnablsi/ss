import { NextResponse } from 'next/server';
import { queryD1, executeD1 } from '@/lib/db';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const userid = url.searchParams.get('userid');
    const reward = url.searchParams.get('reward') || '500'; // Default reward if not specified

    if (!userid) {
      return NextResponse.json({ error: 'Missing userid parameter' }, { status: 400 });
    }

    // Check if user exists
    const users = await queryD1('SELECT id, coins, challenge_coins FROM users WHERE telegram_id = ?', [userid]);
    const user = users[0];

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const rewardAmount = parseInt(reward, 10);
    if (isNaN(rewardAmount) || rewardAmount <= 0) {
      return NextResponse.json({ error: 'Invalid reward amount' }, { status: 400 });
    }

    // Add reward
    await executeD1(`
      UPDATE users 
      SET coins = coins + ?, challenge_coins = COALESCE(challenge_coins, 0) + ? 
      WHERE telegram_id = ?
    `, [rewardAmount, rewardAmount, userid]);

    return NextResponse.json({ success: true, message: `Reward of ${rewardAmount} applied to user ${userid}` });
  } catch (error) {
    console.error('Adsgram reward error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  // Support POST requests as well, just in case Adsgram uses POST
  try {
    const body = await req.json();
    const userid = body.userid;
    const reward = body.reward || 500;

    if (!userid) {
      return NextResponse.json({ error: 'Missing userid parameter' }, { status: 400 });
    }

    // Check if user exists
    const users = await queryD1('SELECT id FROM users WHERE telegram_id = ?', [userid]);
    if (users.length === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const rewardAmount = parseInt(reward, 10);
    if (isNaN(rewardAmount) || rewardAmount <= 0) {
      return NextResponse.json({ error: 'Invalid reward amount' }, { status: 400 });
    }

    // Add reward
    await executeD1(`
      UPDATE users 
      SET coins = coins + ?, challenge_coins = COALESCE(challenge_coins, 0) + ? 
      WHERE telegram_id = ?
    `, [rewardAmount, rewardAmount, userid]);

    return NextResponse.json({ success: true, message: `Reward of ${rewardAmount} applied to user ${userid}` });
  } catch (error) {
    console.error('Adsgram reward error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
