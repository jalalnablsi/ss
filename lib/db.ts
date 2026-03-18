// lib/db.ts
import { getRequestContext } from '@cloudflare/next-on-pages';

// Cache للـ DB binding لتحسين الأداء
let dbCache: any = null;

async function getDBBinding() {
  if (dbCache) return dbCache;
  
  try {
    const context = getRequestContext();
    dbCache = (context?.env as any)?.DB || (process.env as any).DB;
    return dbCache;
  } catch (e) {
    dbCache = (process.env as any).DB;
    return dbCache;
  }
}

export async function queryD1<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const db = await getDBBinding();
  if (!db) throw new Error("Database binding 'DB' missing. Check wrangler.toml or Cloudflare Dashboard.");

  try {
    const { results } = await db.prepare(sql).bind(...params).all();
    return (results || []) as T[];
  } catch (error: any) {
    console.error(`[D1 QUERY ERROR] ${error.message}`, { sql: sql.substring(0, 100), paramsCount: params.length });
    throw new Error(`Database query failed: ${error.message}`);
  }
}

export async function executeD1(sql: string, params: any[] = []): Promise<{ 
  success: boolean; 
  meta?: { changes?: number; last_row_id?: number };
  results?: any[];
}> {
  const db = await getDBBinding();
  if (!db) throw new Error("Database binding 'DB' missing. Check wrangler.toml or Cloudflare Dashboard.");

  const isSelect = sql.trim().toUpperCase().startsWith('SELECT');
  
  try {
    const stmt = db.prepare(sql).bind(...params);
    
    if (isSelect) {
      const { results } = await stmt.all();
      return { success: true, results: results || [] };
    } else {
      // INSERT, UPDATE, DELETE, etc.
      const result = await stmt.run();
      return { 
        success: true, 
        meta: {
          changes: result.meta?.changes,
          last_row_id: result.meta?.last_row_id
        }
      };
    }
  } catch (error: any) {
    console.error(`[D1 EXECUTE ERROR] ${error.message}`, { sql: sql.substring(0, 100), paramsCount: params.length });
    throw new Error(`Database execute failed: ${error.message}`);
  }
}

// Helper للـ transactions (للاستخدام المستقبلي)
export async function batchD1(queries: { sql: string; params: any[] }[]) {
  const db = await getDBBinding();
  if (!db) throw new Error("Database binding 'DB' missing");

  try {
    const statements = queries.map(q => db.prepare(q.sql).bind(...q.params));
    const results = await db.batch(statements);
    return results;
  } catch (error: any) {
    console.error(`[D1 BATCH ERROR] ${error.message}`, { queryCount: queries.length });
    throw new Error(`Database batch failed: ${error.message}`);
  }
}
