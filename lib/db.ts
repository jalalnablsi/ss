// lib/db.ts
import { getRequestContext } from '@cloudflare/next-on-pages';

// دالة مساعدة للحصول على قاعدة البيانات (Binding)
async function getDBBinding() {
  try {
    const context = getRequestContext();
    return context?.env?.DB || (process.env as any).DB;
  } catch (e) {
    return null;
  }
}

// 1. دالة جلب البيانات (SELECT)
export async function queryD1(sql: string, params: any[] = []) {
  const db = await getDBBinding();

  if (db) {
    const { results } = await db.prepare(sql).bind(...params).all();
    return results;
  }

  // Fallback to API
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${process.env.CLOUDFLARE_DATABASE_ID}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql, params }),
  });

  const data = await response.json();
  // تصحيح: الـ API يرجع النتائج داخل مصفوفة result
  return data.result[0]?.results || [];
}

// 2. دالة تنفيذ العمليات (INSERT, UPDATE, DELETE, CREATE) - هذه هي الدالة المفقودة
export async function executeD1(sql: string, params: any[] = []) {
  const db = await getDBBinding();

  if (db) {
    return await db.prepare(sql).bind(...params).run();
  }

  // Fallback to API for execution
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${process.env.CLOUDFLARE_DATABASE_ID}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql, params }),
  });

  return await response.json();
}
