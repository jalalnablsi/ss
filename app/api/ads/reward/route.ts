import { NextResponse } from 'next/server';
import { queryD1, executeD1 } from '@/lib/db';
import { 
  checkAdEligibility, 
  logAdWatch, 
  detectSuspiciousActivity 
} from '@/lib/adProtection';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const userid = url.searchParams.get('userid');
    const reward = url.searchParams.get('reward') || '500';
    const adType = url.searchParams.get('adType') || 'multiplier';

    if (!userid) {
      return NextResponse.json({ error: 'Missing userid parameter' }, { status: 400 });
    }

    // ✅ التحقق من النشاط المشبوه
    const suspiciousCheck = await detectSuspiciousActivity(userid);
    if (suspiciousCheck.isSuspicious) {
      return NextResponse.json({ 
        error: 'Suspicious activity detected', 
        code: 'SUSPICIOUS_ACTIVITY' 
      }, { status: 429 });
    }

    // ✅ التحقق من صلاحية مشاهدة الإعلان
    const eligibility = await checkAdEligibility(userid);
    if (!eligibility.allowed) {
      return NextResponse.json({ 
        error: 'Ad not allowed', 
        code: eligibility.reason,
        details: {
          remainingToday: eligibility.remainingToday,
          remainingThisHour: eligibility.remainingThisHour,
          waitSeconds: eligibility.waitSeconds,
          nextAllowedAt: eligibility.nextAllowedAt
        }
      }, { status: 429 });
    }

    const users = await queryD1('SELECT id, coins, challenge_coins FROM users WHERE telegram_id = ?', [userid]);
    const user = users[0];

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const rewardAmount = parseInt(reward, 10);
    if (isNaN(rewardAmount) || rewardAmount <= 0) {
      return NextResponse.json({ error: 'Invalid reward amount' }, { status: 400 });
    }

    // ✅ تسجيل مشاهدة الإعلان
    await logAdWatch(
      userid,
      adType as 'multiplier' | 'energy' | 'bot',
      rewardAmount,
      req.headers.get('x-forwarded-for') || undefined,
      req.headers.get('user-agent') || undefined
    );

    await executeD1(`
      UPDATE users 
      SET coins = coins + ?, challenge_coins = COALESCE(challenge_coins, 0) + ? 
      WHERE telegram_id = ?
    `, [rewardAmount, rewardAmount, userid]);

    return NextResponse.json({ 
      success: true, 
      message: `Reward of ${rewardAmount} applied to user ${userid}`,
      adProtection: eligibility
    });
  } catch (error) {
    console.error('Adsgram reward error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const userid = body.userid;
    const reward = body.reward || 500;
    const adType = body.adType || 'multiplier';

    if (!userid) {
      return NextResponse.json({ error: 'Missing userid parameter' }, { status: 400 });
    }

    // ✅ التحقق من النشاط المشبوه
    const suspiciousCheck = await detectSuspiciousActivity(userid);
    if (suspiciousCheck.isSuspicious) {
      return NextResponse.json({ 
        error: 'Suspicious activity detected', 
        code: 'SUSPICIOUS_ACTIVITY' 
      }, { status: 429 });
    }

    // ✅ التحقق من صلاحية مشاهدة الإعلان
    const eligibility = await checkAdEligibility(userid);
    if (!eligibility.allowed) {
      return NextResponse.json({ 
        error: 'Ad not allowed', 
        code: eligibility.reason,
        details: {
          remainingToday: eligibility.remainingToday,
          remainingThisHour: eligibility.remainingThisHour,
          waitSeconds: eligibility.waitSeconds,
          nextAllowedAt: eligibility.nextAllowedAt
        }
      }, { status: 429 });
    }

    const users = await queryD1('SELECT id FROM users WHERE telegram_id = ?', [userid]);
    if (users.length === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const rewardAmount = parseInt(reward, 10);
    if (isNaN(rewardAmount) || rewardAmount <= 0) {
      return NextResponse.json({ error: 'Invalid reward amount' }, { status: 400 });
    }

    // ✅ تسجيل مشاهدة الإعلان
    await logAdWatch(
      userid,
      adType as 'multiplier' | 'energy' | 'bot',
      rewardAmount,
      req.headers.get('x-forwarded-for') || undefined,
      req.headers.get('user-agent') || undefined
    );

    await executeD1(`
      UPDATE users 
      SET coins = coins + ?, challenge_coins = COALESCE(challenge_coins, 0) + ? 
      WHERE telegram_id = ?
    `, [rewardAmount, rewardAmount, userid]);

    return NextResponse.json({ 
      success: true, 
      message: `Reward of ${rewardAmount} applied to user ${userid}`,
      adProtection: eligibility
    });
  } catch (error) {
    console.error('Adsgram reward error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
