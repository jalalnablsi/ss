// lib/db.ts
// ✅ متوافق مع @opennextjs/cloudflare

// Cache للـ DB binding
let dbCache: any = null;

async function getDBBinding() {
  if (dbCache) return dbCache;

  try {
    // ✅ الطريقة الجديدة (opennextjs-cloudflare)
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
   const context = getCloudflareContext();
    dbCache = (context.env as any).DB; 
    return dbCache;
  } catch (e) {
    // Fallback للـ local dev
    console.warn('[DB] Using fallback for local development');
    return (process.env as any).DB;
  }
}

export async function queryD1<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const db = await getDBBinding();
  if (!db) throw new Error("Database binding 'DB' missing. Check: 1) Binding name in dashboard 2) wrangler.json");

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
  if (!db) throw new Error("Database binding 'DB' missing. Check: 1) Binding name in dashboard 2) wrangler.json");

  const isSelect = sql.trim().toUpperCase().startsWith('SELECT');
  
  try {
    const stmt = db.prepare(sql).bind(...params);
    
    if (isSelect) {
      const { results } = await stmt.all();
      return { success: true, results: results || [] };
    } else {
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
