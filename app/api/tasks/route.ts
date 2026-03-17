
import { NextResponse } from 'next/server';
import { queryD1, executeD1 } from '@/lib/db';

// --- دوال التشفير المتوافقة مع Edge Runtime ---

async function hmacSha256(key: string | ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    typeof key === 'string' ? encoder.encode(key) : key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
}

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// --- دالة التحقق المعدلة (Async) ---

async function validateTelegramWebAppData(initData: string): Promise<boolean> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return false;

  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    if (!hash) return false;

    urlParams.delete('hash');
    const keys = Array.from(urlParams.keys()).sort();
    let dataCheckString = keys.map(key => `${key}=${urlParams.get(key)}`).join('\n');

    // استخدام Web Crypto بدلاً من createHmac
    const secretKeyBuffer = await hmacSha256('WebAppData', botToken);
    const calculatedHashBuffer = await hmacSha256(secretKeyBuffer, dataCheckString);
    const calculatedHash = bufferToHex(calculatedHashBuffer);

    return calculatedHash === hash;
  } catch (error) {
    return false;
  }
}

export async function POST(req: Request) {
  try {
    const { initData, taskId } = await req.json();

    if (!initData || !taskId) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    // 1. التحقق (إضافة await ضرورية هنا)
    const isValid = await validateTelegramWebAppData(initData);
    if (!isValid && process.env.TELEGRAM_BOT_TOKEN) {
      return NextResponse.json({ error: 'Invalid Telegram data.' }, { status: 403 });
    }

    const urlParams = new URLSearchParams(initData);
    const userStr = urlParams.get('user');
    if (!userStr) return NextResponse.json({ error: 'No user data' }, { status: 400 });

    const tgUser = JSON.parse(userStr);
    const telegramId = tgUser.id.toString();

    // 2. جلب المستخدم من D1
    const users = await queryD1('SELECT coins, challenge_coins, completed_tasks FROM users WHERE telegram_id = ?', [telegramId]);
    const user = users[0];

    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const completedTasks = JSON.parse(user.completed_tasks || '[]');
    if (completedTasks.includes(taskId)) {
      return NextResponse.json({ error: 'Task already completed' }, { status: 400 });
    }

    // حالة خاصة لربط المحفظة
    if (taskId === 'connect_wallet') {
      const newCompletedTasks = [...completedTasks, taskId];
      const newCoins = (user.coins || 0) + 5000;
      const newChallengeCoins = (user.challenge_coins || 0) + 5000;

      await executeD1(`
        UPDATE users SET completed_tasks = ?, coins = ?, challenge_coins = ?, wallet_connected = 1 WHERE telegram_id = ?
      `, [JSON.stringify(newCompletedTasks), newCoins, newChallengeCoins, telegramId]);

      const updatedUsers = await queryD1('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
      const updatedUser = updatedUsers[0];
      updatedUser.completed_tasks = JSON.parse(updatedUser.completed_tasks || '[]');
      updatedUser.wallet_connected = Boolean(updatedUser.wallet_connected);

      return NextResponse.json({ user: updatedUser });
    }

    // 3. جلب بيانات المهمة من جدول المهام
    const tasks = await queryD1('SELECT id, reward_coins FROM tasks WHERE id = ?', [taskId]);
    const taskData = tasks[0];

    if (!taskData) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
    }

    const reward = taskData.reward_coins || 0;

    // 4. تحديث المستخدم بالمكافأة
    const newCompletedTasks = [...completedTasks, taskId];
    const newCoins = (user.coins || 0) + reward;
    const newChallengeCoins = (user.challenge_coins || 0) + reward;

    await executeD1(`
      UPDATE users SET completed_tasks = ?, coins = ?, challenge_coins = ? WHERE telegram_id = ?
    `, [JSON.stringify(newCompletedTasks), newCoins, newChallengeCoins, telegramId]);

    const updatedUsers = await queryD1('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
    const updatedUser = updatedUsers[0];
    updatedUser.completed_tasks = JSON.parse(updatedUser.completed_tasks || '[]');
    updatedUser.wallet_connected = Boolean(updatedUser.wallet_connected);

    return NextResponse.json({ user: updatedUser });
  } catch (error) {
    console.error('Task API Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
