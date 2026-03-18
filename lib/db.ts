// lib/db.ts
import type { D1Database } from '@cloudflare/workers-types';

// ❌ لا تستخدم let متغير عادي - يسبب مشاكل في Edge Runtime
// ✅ استخدام globalThis للحفاظ على الاتصال بين الطلبات
declare global {
  var __D1_DB__: D1Database | undefined;
  var __D1_CACHE_TIME__: number | undefined;
}

interface D1Response {
  results?: any[];
  success: boolean;
  meta?: any;
}

/**
 * الحصول على D1 Database binding مع دعم Cloudflare Pages
 * يعمل مع: @opennextjs/cloudflare + Cloudflare Pages
 */
function getDB(): D1Database {
  // 1. التحقق من التخزين المؤقت (لكن مع انتهاء صلاحية سريع)
  const now = Date.now();
  if (globalThis.__D1_DB__ && globalThis.__D1_CACHE_TIME__ && (now - globalThis.__D1_CACHE_TIME__ < 30000)) {
    return globalThis.__D1_DB__;
  }

  // 2. محاولة الحصول على DB من البيئة المختلفة
  let db: D1Database | undefined;

  // الطريقة 1: process.env (الأكثر شيوعاً في Cloudflare Pages)
  if (process.env.DB && typeof process.env.DB === 'object') {
    db = process.env.DB as unknown as D1Database;
  }
  // الطريقة 2: المتغيرات العامة في Cloudflare
  else if ((globalThis as any).DB) {
    db = (globalThis as any).DB;
  }
  // الطريقة 3: Cloudflare Context (للـ Workers)
  else {
    try {
      // @ts-ignore
      const cf = (globalThis as any).cloudflare || (globalThis as any).CF_CONTEXT;
      if (cf?.env?.DB) {
        db = cf.env.DB;
      }
    } catch (e) {
      // تجاهل الخطأ
    }
  }

  if (!db) {
    throw new Error(
      "❌ Database binding 'DB' not found!\n\n" +
      "الحلول الممكنة:\n" +
      "1. تأكد من وجود binding في dashboard: Pages > Settings > Functions > D1 Databases\n" +
      "2. في wrangler.toml أو pages.toml تأكد من:\n" +
      "   [[d1_databases]]\n" +
      "   binding = 'DB'\n" +
      "   database_name = 'your-db'\n" +
      "   database_id = 'your-id'\n" +
      "3. إذا كنت تستخدم `wrangler dev`، تأكد من تشغيله بـ: `wrangler pages dev`"
    );
  }

  // تخزين مؤقت في globalThis
  globalThis.__D1_DB__ = db;
  globalThis.__D1_CACHE_TIME__ = now;

  return db;
}

/**
 * تنفيذ استعلام SELECT
 * ✅ متوافق 100% مع الكود القديم
 */
export async function queryD1<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const db = getDB();
  
  try {
    const stmt = db.prepare(sql).bind(...params);
    const response = await stmt.all();
    
    return (response?.results || []) as T[];
  } catch (error: any) {
    console.error('[D1 Query Error]', {
      message: error.message,
      sql: sql.substring(0, 100),
      params
    });
    throw new Error(`Query failed: ${error.message}`);
  }
}

/**
 * تنفيذ INSERT/UPDATE/DELETE
 * ✅ متوافق 100% مع الكود القديم
 */
export async function executeD1(
  sql: string, 
  params: any[] = []
): Promise<{ 
  success: boolean; 
  meta?: { 
    changes?: number; 
    last_row_id?: number;
    served_by?: string;
  };
  results?: any[];
}> {
  const db = getDB();
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
          last_row_id: result.meta?.last_row_id,
          served_by: result.meta?.served_by
        }
      };
    }
  } catch (error: any) {
    console.error('[D1 Execute Error]', {
      message: error.message,
      sql: sql.substring(0, 100),
      params
    });
    throw new Error(`Execute failed: ${error.message}`);
  }
}

/**
 * دالة مساعدة للـ Transactions (اختيارية)
 */
export async function transactionD1<T>(queries: { sql: string; params?: any[] }[]): Promise<T[]> {
  const db = getDB();
  const results: T[] = [];
  
  // D1 doesn't support multi-statement transactions in batch yet, 
  // but we can execute sequentially
  for (const query of queries) {
    const res = await executeD1(query.sql, query.params || []);
    if (res.results) {
      results.push(...res.results as T[]);
    }
  }
  
  return results;
}
