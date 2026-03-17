// lib/db.ts

interface Env {
  DB?: D1Database; // الربط المباشر (اختياري)
}

// دالة مساعدة للحصول على الاتصال المناسب
async function getDBConnection(env?: any) {
  // 1. هل يوجد ربط مباشر (الطريقة الجديدة المفضلة)؟
  if (env && env.DB) {
    return { type: 'direct', db: env.DB };
  }

  // 2. هل توجد إعدادات الطريقة القديمة (API Token)؟
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const databaseId = process.env.CLOUDFLARE_DATABASE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (accountId && databaseId && apiToken) {
    return { 
      type: 'api', 
      config: { accountId, databaseId, apiToken } 
    };
  }

  throw new Error('No Database configuration found. Please set up D1 binding or Environment Variables.');
}

/**
 * دالة الاستعلام (SELECT)
 * تعمل مع الطريقتين تلقائياً
 */
export async function queryD1(sql: string, params: any[] = [], contextEnv?: any) {
  const connection = await getDBConnection(contextEnv);

  if (connection.type === 'direct') {
    // الطريقة الجديدة (السريعة والمباشرة)
    const stmt = (connection.db as D1Database).prepare(sql);
    const result = await stmt.bind(...params).all();
    return result.results;
  } else {
    // الطريقة القديمة (عبر API)
    const { accountId, databaseId, apiToken } = connection.config!;
    // تصحيح المسافة الزائدة في الرابط الأصلي لديك
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
    });

    const data = await response.json();
    if (!data.success) {
      console.error('D1 API Error:', data.errors);
      throw new Error(data.errors[0]?.message || 'Database query failed');
    }
    return data.result[0].results;
  }
}

/**
 * دالة التنفيذ (INSERT, UPDATE, DELETE)
 * تعمل مع الطريقتين تلقائياً
 */
export async function executeD1(sql: string, params: any[] = [], contextEnv?: any) {
  const connection = await getDBConnection(contextEnv);

  if (connection.type === 'direct') {
    // الطريقة الجديدة
    const stmt = (connection.db as D1Database).prepare(sql);
    return await stmt.bind(...params).run();
  } else {
    // الطريقة القديمة
    const { accountId, databaseId, apiToken } = connection.config!;
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
    });

    const data = await response.json();
    if (!data.success) {
      console.error('D1 API Error:', data.errors);
      throw new Error(data.errors[0]?.message || 'Database execution failed');
    }
    return data.result[0];
  }
}
