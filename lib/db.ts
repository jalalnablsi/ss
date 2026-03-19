// lib/db.ts
// ✅ متوافق مع @opennextjs/cloudflare و HTTP API

let dbCache: any = null;

async function getDBBinding() {
  if (dbCache) return dbCache;

  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const context: any = await getCloudflareContext();
    
    if (context && context.env && context.env.DB) {
      dbCache = context.env.DB;
      console.log('[DB] Successfully connected to Cloudflare D1 via binding');
      return dbCache;
    }
  } catch (error) {
    // Ignore, fallback to HTTP API
  }

  return null;
}

export async function queryD1<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const db = await getDBBinding();
  
  if (db) {
    try {
      const stmt = db.prepare(sql).bind(...params);
      const { results } = await stmt.all();
      return (results || []) as T[];
    } catch (error: any) {
      console.error('[D1 BINDING QUERY ERROR]', error);
      throw error;
    }
  }

  // Fallback to HTTP API
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const databaseId = process.env.CLOUDFLARE_DATABASE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !databaseId || !apiToken) {
    console.warn('[DB] Missing Cloudflare credentials for HTTP API fallback');
    return [];
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Cloudflare API Error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    if (!data.success) {
      throw new Error(`D1 Query Error: ${JSON.stringify(data.errors)}`);
    }

    return (data.result[0]?.results || []) as T[];
  } catch (error) {
    console.error('[D1 HTTP QUERY ERROR]', error);
    throw error;
  }
}

export async function executeD1(sql: string, params: any[] = []): Promise<{ 
  success: boolean; 
  meta?: { changes?: number; last_row_id?: number };
  results?: any[];
}> {
  const db = await getDBBinding();
  const isSelect = sql.trim().toUpperCase().startsWith('SELECT');
  
  if (db) {
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
            changes: result.meta?.changes || 0,
            last_row_id: result.meta?.last_row_id || 0
          }
        };
      }
    } catch (error: any) {
      console.error('[D1 BINDING EXECUTE ERROR]', error);
      throw error;
    }
  }

  // Fallback to HTTP API
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const databaseId = process.env.CLOUDFLARE_DATABASE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !databaseId || !apiToken) {
    throw new Error('Missing Cloudflare credentials for HTTP API fallback');
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Cloudflare API Error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    if (!data.success) {
      throw new Error(`D1 Execute Error: ${JSON.stringify(data.errors)}`);
    }

    const result = data.result[0];
    if (isSelect) {
      return { success: true, results: result?.results || [] };
    } else {
      return {
        success: true,
        meta: {
          changes: result?.meta?.changes || 0,
          last_row_id: result?.meta?.last_row_id || 0
        }
      };
    }
  } catch (error) {
    console.error('[D1 HTTP EXECUTE ERROR]', error);
    throw error;
  }
}

export async function testConnection(): Promise<boolean> {
  try {
    await queryD1('SELECT 1 as test');
    return true;
  } catch (error) {
    return false;
  }
}

export async function transactionD1(queries: { sql: string; params: any[] }[]): Promise<any[]> {
  const results = [];
  for (const query of queries) {
    const isSelect = query.sql.trim().toUpperCase().startsWith('SELECT');
    if (isSelect) {
      const rows = await queryD1(query.sql, query.params);
      results.push(rows);
    } else {
      const res = await executeD1(query.sql, query.params);
      results.push(res);
    }
  }
  return results;
}

const db = {
  query: queryD1,
  execute: executeD1,
  test: testConnection,
  transaction: transactionD1
};

export default db;
