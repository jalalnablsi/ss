import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { queryD1, executeD1 } from '@/lib/db';
import { validateTelegramWebAppData } from '@/lib/telegram';

export async function POST(req: Request) {
  try {
    const { initData, taskId } = await req.json();

    if (!initData || !taskId) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    // 1. Validate Telegram Data (Anti-Bot)
    const isValid = validateTelegramWebAppData(initData);
    if (!isValid && process.env.TELEGRAM_BOT_TOKEN) {
      return NextResponse.json({ error: 'Invalid Telegram data. Possible bot attack.' }, { status: 403 });
    }

    // Parse user data
    const urlParams = new URLSearchParams(initData);
    const userStr = urlParams.get('user');
    if (!userStr) {
      return NextResponse.json({ error: 'No user data found' }, { status: 400 });
    }

    const tgUser = JSON.parse(userStr);
    const telegramId = tgUser.id.toString();

    // 2. Fetch User from D1
    const users = await queryD1('SELECT coins, challenge_coins, completed_tasks FROM users WHERE telegram_id = ?', [telegramId]);
    const user = users[0];

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const completedTasks = JSON.parse(user.completed_tasks || '[]');
    if (completedTasks.includes(taskId)) {
      return NextResponse.json({ error: 'Task already completed' }, { status: 400 });
    }

    // Special case for wallet connection
    if (taskId === 'connect_wallet') {
      const newCompletedTasks = [...completedTasks, taskId];
      const newCoins = user.coins + 5000;
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

    // Special case for Telegram Channel Verification
    if (taskId === 'tg_channel') {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) {
        return NextResponse.json({ error: 'Telegram bot token not configured' }, { status: 500 });
      }

      const tasks = await queryD1('SELECT link FROM tasks WHERE id = ?', [taskId]);
      const taskLink = tasks[0]?.link;
      
      if (!taskLink) {
        return NextResponse.json({ error: 'Task link not found' }, { status: 400 });
      }

      let channelId = '';
      if (taskLink.includes('t.me/')) {
        const parts = taskLink.split('t.me/');
        const username = parts[1].split('/')[0].split('?')[0];
        if (!username.startsWith('+')) {
          channelId = '@' + username;
        }
      }

      if (channelId) {
        try {
          const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${channelId}&user_id=${telegramId}`);
          const tgData = await tgRes.json();

          if (!tgData.ok || !['member', 'administrator', 'creator'].includes(tgData.result.status)) {
            return NextResponse.json({ error: 'You must join the channel first!' }, { status: 400 });
          }
        } catch (e) {
          console.error('Telegram verification error:', e);
          return NextResponse.json({ error: 'Failed to verify channel membership' }, { status: 500 });
        }
      }
    }

    // 3. Define Task Rewards (Server-Side Truth)
    const tasks = await queryD1('SELECT id, reward_coins FROM tasks WHERE id = ?', [taskId]);
    const taskData = tasks[0];

    if (!taskData) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
    }

    const reward = taskData.reward_coins;

    // 4. Update User
    const newCompletedTasks = [...completedTasks, taskId];
    const newCoins = user.coins + reward;
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
