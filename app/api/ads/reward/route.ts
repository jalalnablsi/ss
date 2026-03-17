// app/api/ads/reward/route.ts
export const runtime = 'edge';
import { NextResponse } from 'next/server';
import { queryD1, executeD1 } from '@/lib/db';

// ملاحظة هامة: هذا الرابط يجب أن يكون متاحاً للعامة (Public)
// لأن خوادم Adsgram هي من ستطلبه، وليس المتصفح.

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    
    // Adsgram سترسل المعرف بهذا الشكل حسب مثالهم: ?userid=123456
    // تأكد من اسم المتغير (userid أو user_id) حسب ما ورد في لوحة تحكمهم بدقة
    const telegramId = searchParams.get('userid'); 

    if (!telegramId) {
      console.warn('Adsgram Reward: Missing userid parameter');
      return NextResponse.json({ success: false, error: 'Missing userid' }, { status: 400 });
    }

    // 1. التحقق من وجود المستخدم
    const users = await queryD1('SELECT id, coins, challenge_coins FROM users WHERE telegram_id = ?', [telegramId]);
    
    if (!users || users.length === 0) {
      console.warn(`Adsgram Reward: User ${telegramId} not found`);
      // نرجع نجاح وهمي أحياناً لتجنب إعادة المحاولة من Adsgram إذا كان المستخدم محذوفاً
      // لكن الأفضل إرجاع خطأ واضح
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    const user = users[0];

    // 2. تحديد قيمة المكافأة
    // يمكنك جعلها قيمة ثابتة أو جلبها من إعدادات عامة
    const REWARD_AMOUNT = 1000; 

    // 3. تحديث رصيد المستخدم
    // نستخدم executeD1 لتحديث مباشر وسريع
    await executeD1(`
      UPDATE users 
      SET coins = coins + ?, 
          challenge_coins = challenge_coins + ?,
          last_update_time = ?
      WHERE telegram_id = ?
    `, [REWARD_AMOUNT, REWARD_AMOUNT, Date.now(), telegramId]);

    console.log(`✅ Adsgram Reward: User ${telegramId} earned ${REWARD_AMOUNT} coins.`);

    // 4. الرد على Adsgram بنجاح
    // معظم شبكات الإعلانات تتوقع نصاً بسيطاً أو JSON معين لتعرف أن العملية نجحت
    // عادة "OK" أو "success" أو JSON { status: "ok" }
    // تحقق من وثائق Adsgram الدقيقة لما يتوقعونه، لكن غالباً JSON آمن.
    return NextResponse.json({ 
      status: 'ok', 
      message: 'Reward granted',
      new_balance: user.coins + REWARD_AMOUNT 
    });

  } catch (error) {
    console.error('❌ Adsgram Reward Error:', error);
    // في حالة الخطأ، نعيد خطأ 500 ليعرف Adsgram أن العملية فشلت وقد يحاولون الإرسال مرة أخرى
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
