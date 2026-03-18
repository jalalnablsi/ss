// lib/db.ts
// ✅ متوافق مع @opennextjs/cloudflare

// Cache للـ DB binding
let dbCache: any = null;

/**
 * الحصول على اتصال قاعدة البيانات من Cloudflare context
 */
async function getDBBinding() {
  // إذا كان موجود في الكاش، نرجعه مباشرة
  if (dbCache) return dbCache;

  try {
    // محاولة الحصول على context من Cloudflare
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    
    // استخدام any لتجنب مشاكل TypeScript
    const context: any = await getCloudflareContext();
    
    // التحقق من وجود context و env
    if (!context || !context.env) {
      console.warn('[DB] Cloudflare context not available, trying fallback...');
      return getFallbackBinding();
    }

    // التحقق من وجود DB binding
    if (!context.env.DB) {
      console.warn('[DB] DB binding not found in Cloudflare context, available keys:', 
        Object.keys(context.env).join(', '));
      return getFallbackBinding();
    }

    // حفظ في الكاش والرجوع
    dbCache = context.env.DB;
    console.log('[DB] Successfully connected to Cloudflare D1');
    return dbCache;

  } catch (error) {
    console.warn('[DB] Error getting Cloudflare context:', error);
    return getFallbackBinding();
  }
}

/**
 * Fallback للتطوير المحلي
 */
function getFallbackBinding() {
  // في بيئة التطوير، نحاول من process.env
  if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
    console.log('[DB] Using local development fallback');
    
    // إذا كان هناك DB في process.env
    if ((process.env as any).DB) {
      dbCache = (process.env as any).DB;
      return dbCache;
    }
    
    // إذا كنا في بيئة محلية ولا يوجد DB، نرجع null
    console.warn('[DB] No database binding available in development mode');
    return null;
  }
  
  // في الإنتاج، هذا خطأ حقيقي
  console.error('[DB] No database binding available in production');
  return null;
}

/**
 * تنفيذ استعلام SELECT وإرجاع النتائج
 * @param sql استعلام SQL
 * @param params المعاملات
 * @returns مصفوفة من النتائج
 */
export async function queryD1<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const db = await getDBBinding();
  
  if (!db) {
    console.error('[DB] Database binding missing - check Cloudflare D1 configuration');
    throw new Error("Database binding 'DB' missing. Please check:");
  }

  try {
    console.log(`[DB] Executing query: ${sql.substring(0, 100)}...`);
    
    const stmt = db.prepare(sql).bind(...params);
    const { results } = await stmt.all();
    
    return (results || []) as T[];
  } catch (error: any) {
    console.error('[D1 QUERY ERROR]', {
      message: error?.message || 'Unknown error',
      sql: sql.substring(0, 200),
      paramsCount: params.length
    });
    throw new Error(`Database query failed: ${error?.message || 'Unknown error'}`);
  }
}

/**
 * تنفيذ استعلامات الكتابة (INSERT, UPDATE, DELETE) أو SELECT
 * @param sql استعلام SQL
 * @param params المعاملات
 * @returns نتيجة التنفيذ
 */
export async function executeD1(sql: string, params: any[] = []): Promise<{ 
  success: boolean; 
  meta?: { changes?: number; last_row_id?: number };
  results?: any[];
}> {
  const db = await getDBBinding();
  
  if (!db) {
    console.error('[DB] Database binding missing - check Cloudflare D1 configuration');
    throw new Error("Database binding 'DB' missing. Please check:");
  }

  // تحديد نوع الاستعلام
  const isSelect = sql.trim().toUpperCase().startsWith('SELECT');
  
  try {
    console.log(`[DB] Executing ${isSelect ? 'SELECT' : 'WRITE'}: ${sql.substring(0, 100)}...`);
    
    const stmt = db.prepare(sql).bind(...params);
    
    if (isSelect) {
      const { results } = await stmt.all();
      return { 
        success: true, 
        results: results || [] 
      };
    } else {
      const result = await stmt.run();
      return { 
        success: true, 
        meta: {
          changes: result.meta?.changes || 0,
          last_row_id: result.meta?.last_row_id || 0
        }
      };
    }
  } catch (error: any) {
    console.error('[D1 EXECUTE ERROR]', {
      message: error?.message || 'Unknown error',
      sql: sql.substring(0, 200),
      paramsCount: params.length
    });
    throw new Error(`Database execute failed: ${error?.message || 'Unknown error'}`);
  }
}

/**
 * اختبار الاتصال بقاعدة البيانات
 * @returns boolean
 */
export async function testConnection(): Promise<boolean> {
  try {
    const result = await queryD1<{ test: number }>('SELECT 1 as test');
    console.log('[DB] Connection test successful:', result);
    return true;
  } catch (error) {
    console.error('[DB] Connection test failed:', error);
    return false;
  }
}

/**
 * تنفيذ معاملة (Transaction) - لعمليات متعددة
 * @param queries مصفوفة من الاستعلامات
 * @returns النتائج
 */
export async function transactionD1(queries: { sql: string; params: any[] }[]): Promise<any[]> {
  const db = await getDBBinding();
  
  if (!db) {
    throw new Error("Database binding 'DB' missing");
  }

  const results = [];
  
  try {
    // D1 لا يدعم المعاملات الحقيقية، لكن ننفذ بالتسلسل
    for (const query of queries) {
      const stmt = db.prepare(query.sql).bind(...query.params);
      
      if (query.sql.trim().toUpperCase().startsWith('SELECT')) {
        const { results: rows } = await stmt.all();
        results.push(rows);
      } else {
        const result = await stmt.run();
        results.push(result);
      }
    }
    
    return results;
  } catch (error: any) {
    console.error('[D1 TRANSACTION ERROR]', error);
    throw new Error(`Transaction failed: ${error.message}`);
  }
}

export default {
  query: queryD1,
  execute: executeD1,
  test: testConnection,
  transaction: transactionD1
};
