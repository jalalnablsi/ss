import { NextResponse } from 'next/server';
import { checkAdEligibility, getUserAdStats } from '@/lib/adProtection';
import { queryD1 } from '@/lib/db';

export async function POST(req: Request) {
  try {
    const { initData } = await req.json();
    
    if (!initData) {
      return NextResponse.json({ error: 'Missing initData' }, { status: 400 });
    }

    // Extract user ID
    const urlParams = new URLSearchParams(initData);
    const userStr = urlParams.get('user');
    if (!userStr) {
      return NextResponse.json({ error: 'No user data' }, { status: 400 });
    }

    const tgUser = JSON.parse(decodeURIComponent(userStr));
    const telegramId = tgUser.id.toString();

    // Verify user exists
    const users = await queryD1('SELECT id FROM users WHERE telegram_id = ?', [telegramId]);
    if (users.length === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Check eligibility
    const eligibility = await checkAdEligibility(telegramId);
    const stats = await getUserAdStats(telegramId);

    // ✅ Return consistent data structure with sync API
    return NextResponse.json({
      isAllowed: eligibility.allowed,
      remainingToday: eligibility.remainingToday,
      remainingThisHour: eligibility.remainingThisHour,
      waitSeconds: eligibility.waitSeconds,
      nextAdInSeconds: eligibility.waitSeconds, // Alias for frontend compatibility
      nextAllowedAt: eligibility.nextAllowedAt,
      currentTier: eligibility.currentTier,
      reason: eligibility.reason,
      stats: {
        totalToday: stats.totalToday,
        thisHour: stats.thisHour,
        lastAdAt: stats.lastAdAt,
        nextAdInSeconds: stats.nextAdInSeconds
      }
    });

  } catch (error) {
    console.error('Ad check error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
