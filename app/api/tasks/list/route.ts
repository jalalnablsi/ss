import { NextResponse } from 'next/server';
import { queryD1 } from '@/lib/db';

export async function GET() {
  try {
    const tasks = await queryD1('SELECT * FROM tasks WHERE is_active = 1 ORDER BY created_at ASC');
    
    // Convert boolean
    const formattedTasks = tasks.map((t: any) => ({
      ...t,
      is_active: Boolean(t.is_active)
    }));

    return NextResponse.json({ tasks: formattedTasks });
  } catch (error) {
    console.error('Fetch tasks error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
