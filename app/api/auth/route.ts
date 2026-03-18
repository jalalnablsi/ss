import { NextResponse } from 'next/server';
import { queryD1, executeD1 } from '@/lib/db';

/**
 * دالة التحقق من التشفير - تم تحسينها لتقليل تخصيص الذاكرة
 */
async function validateTelegram(initData: string): Promise<boolean> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return false;

  params.delete('hash');
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const encoder = new TextEncoder();
  const secretKey = await crypto.subtle.importKey('raw', encoder.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const botKey = await crypto.subtle.sign('HMAC', secretKey, encoder.encode(botToken));
  const signatureKey = await crypto.subtle.importKey('raw', botKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', signatureKey, encoder.encode(dataCheckString));

  const hex = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
  return hex === hash;
}

export const runtime = 'edge'; // تفعيل Edge Runtime لأقصى سرعة

export async function POST(req: Request) {
  const now = Date.now();
  const today = new Date().toISOString().split('T')[0];

  try {
    const { initData, referralCode } = await req.json();

    if (!(await validateTelegram(initData))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const tgUser = JSON.parse(new URLSearchParams(initData).get('user') || '{}');
    if (!tgUser.id) return NextResponse.json({ error: 'Invalid User' }, { status: 400 });

    const telegramId = tgUser.id.toString();

    /**
     * استراتيجية "الضربة الواحدة" (Upsert Strategy)
     * نحاول إدراج المستخدم، وإذا وجدناه نقوم بتحديث الحقول الحساسة للزمن فقط
     * هذا يقلل Rows Read/Write إلى الحد الأدنى
     */
    const upsertQuery = `
      INSERT INTO users (
        id, telegram_id, first_name, last_name, username, 
        last_update_time, referred_by, last_ad_watch_date, challenge_coins
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(telegram_id) DO UPDATE SET
        last_ad_watch_date = excluded.last_ad_watch_date,
        ads_watched_today = CASE WHEN last_ad_watch_date != excluded.last_ad_watch_date THEN 0 ELSE ads_watched_today END,
        -- تحديثات الطاقة والعملات تتم هنا برمجياً لاحقاً أو عبر SQL للحفاظ على الدقة --
        last_update_time = excluded.last_update_time
      RETURNING *;
    `;

    const users = await queryD1(upsertQuery, [
      crypto.randomUUID(), telegramId, tgUser.first_name || '', 
      tgUser.last_name || null, tgUser.username || null, 
      now, referralCode || null, today
    ]);

    let user = users[0];

    /**
     * منطق الـ Business Logic (الطاقة والـ Bot)
     * يتم حسابها وحفظها فقط إذا تغيرت بشكل كبير لتوفير عمليات الكتابة
     */
    const timePassedSec = Math.floor((now - user.last_update_time) / 1000);
    let needsSync = false;

    // حساب الطاقة (Logic-only)
    if (user.energy < user.max_energy && timePassedSec > 60) {
      const recovery = Math.floor(timePassedSec * (user.max_energy / 1800));
      user.energy = Math.min(user.max_energy, user.energy + recovery);
      needsSync = true;
    }

    // حساب الـ Bot
    if (user.auto_bot_active_until > user.last_update_time) {
      const activeMs = Math.min(now, user.auto_bot_active_until) - user.last_update_time;
      const earned = Math.floor((activeMs / 1000) * 0.5);
      if (earned > 0) {
        user.coins += earned;
        user.challenge_coins += earned;
        needsSync = true;
      }
    }

    // تحديث نهائي إذا لزم الأمر
    if (needsSync) {
      await executeD1(
        'UPDATE users SET energy = ?, coins = ?, challenge_coins = ?, last_update_time = ? WHERE telegram_id = ?',
        [user.energy, user.coins, user.challenge_coins, now, telegramId]
      );
    }

    return NextResponse.json({
      user: { ...user, completed_tasks: JSON.parse(user.completed_tasks || '[]') },
      serverTime: now
    });

  } catch (error) {
    console.error('CRITICAL_AUTH_ERROR:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
