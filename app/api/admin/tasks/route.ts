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
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const tasks = await queryD1('SELECT * FROM tasks ORDER BY created_at DESC');
    
    // Format boolean
    const formattedTasks = tasks.map((t: any) => ({
      ...t,
      is_active: Boolean(t.is_active)
    }));

    return NextResponse.json({ tasks: formattedTasks });
  } catch (error) {
    console.error('Admin fetch tasks error:', error);
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const taskData = await req.json();
    const id = taskData.id || crypto.randomUUID();
    
    await executeD1(`
      INSERT INTO tasks (id, title, description, reward_coins, icon_name, link, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      taskData.title,
      taskData.description || null,
      taskData.reward_coins,
      taskData.icon_name || 'CheckCircle',
      taskData.link || null,
      taskData.is_active ? 1 : 0
    ]);

    const newTask = await queryD1('SELECT * FROM tasks WHERE id = ?', [id]);
    
    if (newTask.length > 0) {
        newTask[0].is_active = Boolean(newTask[0].is_active);
    }

    return NextResponse.json({ task: newTask[0] });
  } catch (error) {
    console.error('Admin create task error:', error);
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const taskData = await req.json();
    const { id, ...updates } = taskData;
    
    if (!id) {
        return NextResponse.json({ error: 'Missing task ID' }, { status: 400 });
    }

    const setClauses = [];
    const values = [];
    
    for (const [key, value] of Object.entries(updates)) {
        setClauses.push(`${key} = ?`);
        values.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
    }
    
    if (setClauses.length === 0) {
         return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
    }
    
    values.push(id);

    await executeD1(`
      UPDATE tasks SET ${setClauses.join(', ')} WHERE id = ?
    `, values);

    const updatedTask = await queryD1('SELECT * FROM tasks WHERE id = ?', [id]);
    
    if (updatedTask.length > 0) {
        updatedTask[0].is_active = Boolean(updatedTask[0].is_active);
    }

    return NextResponse.json({ task: updatedTask[0] });
  } catch (error) {
    console.error('Admin update task error:', error);
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 });
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

    await executeD1('DELETE FROM tasks WHERE id = ?', [id]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Admin delete task error:', error);
    return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 });
  }
}
