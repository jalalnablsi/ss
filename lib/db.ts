// lib/db.ts
import { getRequestContext } from '@cloudflare/next-on-pages';

export async function queryD1(sql: string, params: any[] = []) {
  try {
    // حاول استخدام الاتصال المباشر (الأسرع)
    const context = getRequestContext();
    const db = context?.env?.DB;

    if (db) {
      const { results } = await db.prepare(sql).bind(...params).all();
      return results;
    }
  } catch (e) {
    console.log("Binding not found, falling back to API...");
  }

  // إذا لم يجد الـ Binding (مثلاً تشغله لوكال)، استخدم الـ API القديم الخاص بك
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${process.env.CLOUDFLARE_DATABASE_ID}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql, params }),
  });

  const data = await response.json();
  return data.result[0].results;
}
