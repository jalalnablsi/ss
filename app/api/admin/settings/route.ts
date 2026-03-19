import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { queryD1, executeD1 } from '@/lib/db';

async function isAdmin() {
  const cookieStore = await cookies();
  return cookieStore.get('admin_session')?.value === 'authenticated';
}

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    try {
      await executeD1(`
        CREATE TABLE IF NOT EXISTS settings (
          id INTEGER PRIMARY KEY,
          adsgram_block_id TEXT
        )
      `);
    } catch (e) {
      // Ignore
    }

    const settings = await queryD1('SELECT * FROM settings WHERE id = 1');
    return NextResponse.json({ settings: settings[0] || { adsgram_block_id: '' } });
  } catch (error) {
    console.error('Admin settings GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { adsgram_block_id } = await req.json();

    if (typeof adsgram_block_id !== 'string') {
      return NextResponse.json({ error: 'Invalid block ID' }, { status: 400 });
    }

    await executeD1(`
      INSERT INTO settings (id, adsgram_block_id) 
      VALUES (1, ?) 
      ON CONFLICT(id) DO UPDATE SET adsgram_block_id = excluded.adsgram_block_id
    `, [adsgram_block_id]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Admin settings PUT error:', error);
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}
