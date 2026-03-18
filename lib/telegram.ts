// lib/telegram.ts
// ✅ متوافق 100% مع Cloudflare Edge Runtime

/**
 * دالة التحقق من Telegram WebApp Data
 * تستخدم Web Crypto API بدلاً من Node crypto
 */
export async function validateTelegramWebAppData(initData: string): Promise<boolean> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  
  if (!botToken) {
    console.error('[TELEGRAM] TELEGRAM_BOT_TOKEN is not set');
    // في الإنتاج: يجب رفض الطلب إذا لا يوجد توكن
    return false;
  }

  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    
    if (!hash) {
      console.error('[TELEGRAM] Missing hash in initData');
      return false;
    }

    // إنشاء dataCheckString (مرتب أبجدياً)
    urlParams.delete('hash');
    const keys = Array.from(urlParams.keys()).sort();
    const dataCheckString = keys.map(key => `${key}=${urlParams.get(key)}`).join('\n');

    // ✅ Web Crypto API (يعمل في Edge Runtime)
    const secretKey = await hmacSha256('WebAppData', botToken);
    const calculatedHash = bufferToHex(await hmacSha256(secretKey, dataCheckString));

    const isValid = calculatedHash === hash;
    
    if (!isValid) {
      console.error('[TELEGRAM] Hash mismatch:', {
        received: hash.slice(0, 20) + '...',
        calculated: calculatedHash.slice(0, 20) + '...',
        dataLength: dataCheckString.length
      });
    }

    return isValid;
    
  } catch (error) {
    console.error('[TELEGRAM] Validation error:', error);
    return false;
  }
}

/**
 * HMAC-SHA256 باستخدام Web Crypto API
 */
async function hmacSha256(key: string | ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    typeof key === 'string' ? encoder.encode(key) : key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  return await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
}

/**
 * تحويل ArrayBuffer إلى Hex string
 */
function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * استخراج بيانات المستخدم من initData
 */
export function parseInitData(initData: string): any | null {
  try {
    const urlParams = new URLSearchParams(initData);
    const userStr = urlParams.get('user');
    
    if (userStr) {
      return JSON.parse(userStr);
    }
    
    // محاولة استخراج user من بيانات أخرى إذا كان التنسيق مختلفاً
    const authDate = urlParams.get('auth_date');
    const hash = urlParams.get('hash');
    
    console.log('[TELEGRAM] Parsed params:', { 
      hasUser: !!userStr, 
      authDate, 
      hashLength: hash?.length 
    });
    
  } catch (e) {
    console.error('[TELEGRAM] Error parsing initData:', e);
  }
  
  return null;
}

/**
 * التحقق السريع (للاستخدام في middleware)
 */
export async function quickValidate(initData: string): Promise<{
  valid: boolean;
  userId?: string;
  error?: string;
}> {
  const isValid = await validateTelegramWebAppData(initData);
  
  if (!isValid) {
    return { valid: false, error: 'Invalid Telegram signature' };
  }
  
  const user = parseInitData(initData);
  
  if (!user?.id) {
    return { valid: false, error: 'No user data found' };
  }
  
  return { valid: true, userId: user.id.toString() };
}
