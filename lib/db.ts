// lib/db.ts
// ✅ متوافق مع @opennextjs/cloudflare

// Cache للـ DB binding
let dbCache: any = null;

async function getDBBinding() {
  if (dbCache) return dbCache;

  try {
    // ✅ الطريقة الجديدة (opennextjs-cloudflare)
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    
    // الحصول على الـ context بطريقة صحيحة
    const context = await getCloudflareContext();
    
    // التحقق من وجود env في context
    if (!context || !context.env) {
      console.error('[DB] Cloudflare context or env is missing', context);
      throw new Error('Cloudflare context not available');
    }

    // التأكد من وجود DB binding
    if (!context.env.DB) {
      console.error('[DB] DB binding not found in env. Available bindings:', Object.keys(context.env));
      throw new Error('DB binding not found in Cloudflare context');
    }

    dbCache = context.env.DB;
    console.log('[DB] Successfully connected to D1 database');
    return dbCache;
  } catch (e) {
    console.error('[DB] Error getting Cloudflare context:', e);
    
    // Fallback للـ local dev
    console.warn('[DB] Using fallback for local development');
    
    // التحقق من وجود DB في process.env
    if (!(process.env as any).DB) {
      console.error('[DB] No DB binding found in process.env for local development');
      return null;
    }
    
    return (process.env as any).DB;
  }
}

export async function queryD1<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  try {
    const db = await getDBBinding();
    
    if (!db) {
      throw new Error("Database binding 'DB' missing. Check: 1) Binding name in dashboard 2) wrangler.json 3) Cloudflare context");
    }

    console.log(`[DB] Executing query: ${sql.substring(0, 100)}...`);
    
    const stmt = db.prepare(sql).bind(...params);
    const { results } = await stmt.all();
    
    return (results || []) as T[];
  } catch (error: any) {
    console.error(`[D1 QUERY ERROR] ${error.message}`, { 
      sql: sql.substring(0, 100), 
      paramsCount: params.length 
    });
    throw new Error(`Database query failed: ${error.message}`);
  }
}

export async function executeD1(sql: string, params: any[] = []): Promise<{ 
  success: boolean; 
  meta?: { changes?: number; last_row_id?: number };
  results?: any[];
}> {
  try {
    const db = await getDBBinding();
    
    if (!db) {
      throw new Error("Database binding 'DB' missing. Check: 1) Binding name in dashboard 2) wrangler.json 3) Cloudflare context");
    }

    const isSelect = sql.trim().toUpperCase().startsWith('SELECT');
    
    console.log(`[DB] Executing ${isSelect ? 'SELECT' : 'WRITE'} query: ${sql.substring(0, 100)}...`);
    
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
    console.error(`[D1 EXECUTE ERROR] ${error.message}`, { 
      sql: sql.substring(0, 100), 
      paramsCount: params.length 
    });
    throw new Error(`Database execute failed: ${error.message}`);
  }
}

// دالة مساعدة لاختبار الاتصال
export async function testConnection(): Promise<boolean> {
  try {
    const result = await queryD1('SELECT 1 as test');
    console.log('[DB] Connection test successful:', result);
    return true;
  } catch (error) {
    console.error('[DB] Connection test failed:', error);
    return false;
  }
}
