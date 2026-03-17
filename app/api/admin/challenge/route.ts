import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { queryD1, executeD1 } from '@/lib/db';
import crypto from 'crypto';

// Middleware to check admin session
async function isAdmin() {
  const cookieStore = await cookies();
  return cookieStore.get('admin_session')?.value === 'authenticated';
}

export async function GET() {
  try {
    // Ensure challenges table exists
    try {
      await executeD1(`
        CREATE TABLE IF NOT EXISTS challenges (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          start_time INTEGER NOT NULL,
          end_time INTEGER NOT NULL,
          is_active INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } catch (e) {
      // Ignore
    }

    const challenges = await queryD1('SELECT * FROM challenges WHERE is_active = 1 ORDER BY start_time DESC LIMIT 1');
    return NextResponse.json({ challenge: challenges[0] || null });
  } catch (error) {
    console.error('Fetch challenge error:', error);
    return NextResponse.json({ error: 'Failed to fetch challenge' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { days } = await req.json();
    
    if (!days || isNaN(days) || days <= 0) {
      return NextResponse.json({ error: 'Invalid days' }, { status: 400 });
    }

    const now = Date.now();
    const endTime = now + (days * 24 * 60 * 60 * 1000);
    const id = crypto.randomUUID();

    // End any active challenges
    await executeD1('UPDATE challenges SET is_active = 0 WHERE is_active = 1');
    
    // Reset challenge_coins for all users
    await executeD1('UPDATE users SET challenge_coins = 0');

    // Create new challenge
    await executeD1(`
      INSERT INTO challenges (id, title, start_time, end_time, is_active)
      VALUES (?, ?, ?, ?, 1)
    `, [id, 'Active Challenge', now, endTime]);

    const newChallenge = await queryD1('SELECT * FROM challenges WHERE id = ?', [id]);
    
    return NextResponse.json({ challenge: newChallenge[0] });
  } catch (error) {
    console.error('Create challenge error:', error);
    return NextResponse.json({ error: 'Failed to create challenge' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id, addDays } = await req.json();
    
    if (!id || !addDays || isNaN(addDays)) {
      return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });
    }

    const challenges = await queryD1('SELECT * FROM challenges WHERE id = ?', [id]);
    const challenge = challenges[0];

    if (!challenge) {
      return NextResponse.json({ error: 'Challenge not found' }, { status: 404 });
    }

    const newEndTime = challenge.end_time + (addDays * 24 * 60 * 60 * 1000);

    await executeD1('UPDATE challenges SET end_time = ? WHERE id = ?', [newEndTime, id]);

    const updatedChallenge = await queryD1('SELECT * FROM challenges WHERE id = ?', [id]);
    
    return NextResponse.json({ challenge: updatedChallenge[0] });
  } catch (error) {
    console.error('Update challenge error:', error);
    return NextResponse.json({ error: 'Failed to update challenge' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    
    if (!id) return NextResponse.json({ error: 'Missing ID' }, { status: 400 });

    await executeD1('UPDATE challenges SET is_active = 0 WHERE id = ?', [id]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('End challenge error:', error);
    return NextResponse.json({ error: 'Failed to end challenge' }, { status: 500 });
  }
}
