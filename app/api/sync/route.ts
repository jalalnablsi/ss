import { executeD1 } from '@/lib/db';
import { validateTelegramWebAppData, parseInitData } from '@/lib/telegram';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge'; // ضروري جداً للأداء الأقصى على Cloudflare

export async function POST(req: NextRequest) {
  try {
    const { initData, taps, clientTime } = await req.json();

    // 1. التحقق من أمان البيانات (منع التزوير)
    const isValid = await validateTelegramWebAppData(initData);
    if (!isValid) {
      return NextResponse.json({ error: 'Unauthorized Signature' }, { status: 401 });
    }

    const tgUser = parseInitData(initData);
    if (!tgUser || !tgUser.id) {
      return NextResponse.json({ error: 'Invalid User Data' }, { status: 400 });
    }

    const userId = tgUser.id;
    const username = tgUser.username || 'joker_player';
    
    // استخراج كود الإحالة من start_param إذا وجد
    const urlParams = new URLSearchParams(initData);
    const referrerId = urlParams.get('start_param');

    /**
     * 2. الضربة القاضية لهلاك الداتا بيز: Atomic Upsert
     * - INSERT أو UPDATE في طلب واحد.
     * - إضافة النقرات (coins) بدلاً من استبدالها.
     * - خصم الطاقة بناءً على عدد النقرات الفعلي.
     * - التعامل مع الإحالات (Referral) فقط عند إنشاء الحساب لأول مرة.
     */
    const syncSql = `
      INSERT INTO users (id, username, coins, energy, referred_by, last_sync)
      VALUES (?, ?, ?, 500, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        username = excluded.username,
        coins = coins + excluded.coins,
        energy = MAX(0, energy - ?),
        last_sync = excluded.last_sync
      RETURNING *;
    `;

    // تنفيذ الاستعلام الرئيسي
    const result = await executeD1(syncSql, [
      userId,
      username,
      taps,          // العملات المكتسبة في هذه الجلسة
      referrerId,    // يُسجل فقط إذا كان المستخدم جديداً
      Date.now(),
      taps           // الطاقة المخصومة (تساوي عدد النقرات)
    ]);

    const user = result.results?.[0];

    // 3. منطق مكافأة الإحالة (تتم مرة واحدة فقط عند نجاح الـ Insert الجديد)
    // إذا كان result.meta.changes > 0 وكان هناك referrerId
    if (result.meta?.last_row_id && referrerId && referrerId !== userId.toString()) {
       // إضافة 5000 عملة للشخص الذي دعا المستخدم الجديد
       await executeD1(
         `UPDATE users SET coins = coins + 5000 WHERE id = ?`,
         [referrerId]
       );
    }

    // 4. إرجاع البيانات المحدثة للفرونت اند للمزامنة
    return NextResponse.json({
      success: true,
      user: {
        coins: user.coins,
        energy: user.energy,
        max_energy: 500,
        tap_multiplier: user.tap_multiplier || 1,
        tap_multiplier_end_time: user.tap_multiplier_end_time || 0,
        auto_bot_active_until: user.auto_bot_active_until || 0
      }
    });

  } catch (error: any) {
    console.error('[SYNC_ERROR]:', error.message);
    return NextResponse.json({ 
      error: 'Internal Server Error',
      details: error.message 
    }, { status: 500 });
  }
}
