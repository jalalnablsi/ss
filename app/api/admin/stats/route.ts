import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { queryD1 } from '@/lib/db';

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
    // Get total users
    const usersResult = await queryD1('SELECT COUNT(*) as count FROM users');
    const totalUsers = usersResult[0]?.count || 0;

    // Get total ad watches
    const adsResult = await queryD1('SELECT COUNT(*) as count FROM ad_watches');
    const totalAds = adsResult[0]?.count || 0;

    // Get total tasks completed
    const usersData = await queryD1('SELECT completed_tasks FROM users');
      
    let totalTasksCompleted = 0;
    if (usersData) {
      totalTasksCompleted = usersData.reduce((acc: number, user: any) => {
        try {
            const tasks = JSON.parse(user.completed_tasks || '[]');
            return acc + tasks.length;
        } catch (e) {
            return acc;
        }
      }, 0);
    }

    return NextResponse.json({
      totalUsers,
      totalAds,
      totalTasksCompleted
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}
