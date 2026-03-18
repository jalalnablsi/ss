// lib/db.ts
import { getRequestContext } from '@cloudflare/next-on-pages';

async function getDBBinding() {
  try {
    const context = getRequestContext();
    return (context?.env as any)?.DB || (process.env as any).DB;
  } catch (e) {
    return (process.env as any).DB;
  }
}

export async function queryD1<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const db = await getDBBinding();
  if (!db) throw new Error("Database binding missing");

  try {
    const { results } = await db.prepare(sql).bind(...params).all();
    return results as T[];
  } catch (error: any) {
    console.error(`D1 Query Error: ${error.message}`, { sql, params });
    throw error;
  }
}

export async function executeD1(sql: string, params: any[] = []) {
  const db = await getDBBinding();
  if (!db) throw new Error("Database binding missing");

  try {
    const stmt = db.prepare(sql).bind(...params);
    // نستخدم run() للأوامر التي لا ترجع بيانات، و all() إذا كنا نتوقع نتائج
    if (sql.trim().toUpperCase().startsWith('SELECT')) {
      const { results } = await stmt.all();
      return results;
    } else {
      const res = await stmt.run();
      return res;
    }
  } catch (error: any) {
    console.error(`D1 Execute Error: ${error.message}`, { sql, params });
    throw error;
  }
}
