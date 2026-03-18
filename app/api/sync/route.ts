import { NextResponse } from 'next/server';
import { queryD1, executeD1 } from '@/lib/db';
import { validateTelegramWebAppData, parseInitData } from '@/lib/telegram';

// Rate Limiting - 20 طلب في الثانية كحد أقصى
const rateLimits = new Map<string, { count: number; resetTime: number }>();

function checkRateLimit(telegramId: string): boolean {
  const now = Date.now();
  const windowMs = 1000; // ثانية واحدة
  const maxRequests = 20; // 20 طلب كحد أقصى في الثانية

  const current = rateLimits.get(telegramId);

  if (!current || now > current.resetTime) {
    rateLimits.set(telegramId, { count: 1, resetTime: now + windowMs });
    return true;
  }

  if (current.count >= maxRequests) {
    return false;
  }

  current.count++;
  return true;
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID().slice(0, 4);
  const startTime = performance.now();

  try {
    const { initData, taps, clientTime } = await req.json();

    // التحقق الأساسي
    if (!initData) {
      return NextResponse.json({ error: 'No initData' }, { status: 400 });
    }

    if (!taps || typeof taps !== 'number' || taps <= 0 || taps > 50) {
      return NextResponse.json({ error: 'Invalid taps' }, { status: 400 });
    }

    // التحقق من Telegram
    const isValid = await validateTelegramWebAppData(initData);
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid' }, { status: 403 });
    }

    // استخراج المستخدم
    const tgUser = parseInitData(initData);
    if (!tgUser?.id) {
      return NextResponse.json({ error: 'No user' }, { status: 400 });
    }

    const telegramId = tgUser.id.toString();

    // Rate Limiting
    if (!checkRateLimit(telegramId)) {
      return NextResponse.json({ error: 'Too fast' }, { status: 429 });
    }

    // جلب المستخدم
    const users = await queryD1('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
    const user = users[0];
    
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const now = Date.now();

    // حساب استعادة الطاقة
    const timePassedSec = Math.floor((now - user.last_update_time) / 1000);
    const regenRate = user.max_energy / 1800; // 30 دقيقة كاملة
    const recoveredEnergy = Math.floor(timePassedSec * regenRate);
    const currentEnergy = Math.min(user.max_energy, user.energy + recoveredEnergy);

    // التحقق من الطاقة
    if (currentEnergy < taps) {
      // إذا الطاقة مش كافية، نكتفي باللي موجود
      const availableTaps = currentEnergy;
      
      // حساب المكسب
      const isMultiplierActive = user.tap_multiplier_end_time > now;
      const multiplier = isMultiplierActive ? user.tap_multiplier : 1;
      const earned = availableTaps * multiplier;

      // تحديث المستخدم
      await executeD1(
        `UPDATE users SET 
          coins = coins + ?,
          challenge_coins = challenge_coins + ?,
          energy = 0,
          total_taps = total_taps + ?,
          last_update_time = ?
        WHERE telegram_id = ?`,
        [earned, earned, availableTaps, now, telegramId]
      );

      // جلب البيانات المحدثة
      const updated = await queryD1('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);

      return NextResponse.json({
        user: {
          coins: updated[0].coins,
          energy: 0,
          max_energy: updated[0].max_energy,
          tap_multiplier: updated[0].tap_multiplier,
          tap_multiplier_end_time: updated[0].tap_multiplier_end_time,
          auto_bot_active_until: updated[0].auto_bot_active_until
        },
        serverTime: now,
        meta: {
          processed: availableTaps,
          earned,
          fullEnergy: false
        }
      });
    }

    // الطاقة كافية
    const isMultiplierActive = user.tap_multiplier_end_time > now;
    const multiplier = isMultiplierActive ? user.tap_multiplier : 1;
    const earned = taps * multiplier;

    // تحديث المستخدم
    await executeD1(
      `UPDATE users SET 
        coins = coins + ?,
        challenge_coins = challenge_coins + ?,
        energy = ?,
        total_taps = total_taps + ?,
        last_update_time = ?
      WHERE telegram_id = ?`,
      [earned, earned, currentEnergy - taps, taps, now, telegramId]
    );

    // التحقق من مكافأة الإحالة (500 ضغطة) - بدون مشكلة TypeScript
    if (user.total_taps < 500 && user.total_taps + taps >= 500 && user.referred_by) {
      try {
        const result = await executeD1(
          `UPDATE users 
           SET coins = coins + 1500,
               challenge_coins = COALESCE(challenge_coins, 0) + 1500,
               referrals_activated = referrals_activated + 1
           WHERE telegram_id = ?`,
          [user.referred_by]
        );
        
        // ✅ هنا المشكلة كانت - هذا السطر معدل وآمن
        if (result && result.meta && typeof result.meta.changes === 'number' && result.meta.changes > 0) {
          console.log(`[${requestId}] Referral rewarded: ${user.referred_by}`);
        }
      } catch (e) {
        console.error(`[${requestId}] Referral error:`, e);
      }
    }

    // جلب البيانات المحدثة
    const updated = await queryD1('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);

    const duration = performance.now() - startTime;
    console.log(`[${requestId}] ${taps} taps, ${duration.toFixed(0)}ms`);

    return NextResponse.json({
      user: {
        coins: updated[0].coins,
        energy: updated[0].energy,
        max_energy: updated[0].max_energy,
        tap_multiplier: updated[0].tap_multiplier,
        tap_multiplier_end_time: updated[0].tap_multiplier_end_time,
        auto_bot_active_until: updated[0].auto_bot_active_until
      },
      serverTime: now,
      meta: {
        processed: taps,
        earned,
        fullEnergy: true
      }
    });

  } catch (error) {
    console.error('Sync error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ status: 'ok' });
}
