// lib/telegram.ts
import crypto from 'crypto';

export function validateTelegramWebAppData(initData: string): boolean {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  
  if (!botToken) {
    console.error('❌ TELEGRAM_BOT_TOKEN is missing');
    return false;
  }

  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    
    if (!hash) return false;

    urlParams.delete('hash');
    
    // ترتيب المفاتيح أبجدياً (شرط تليجرام)
    const keys = Array.from(urlParams.keys()).sort();
    
    let dataCheckString = '';
    for (const key of keys) {
      dataCheckString += `${key}=${urlParams.get(key)}\n`;
    }
    // إزالة السطر الأخير
    dataCheckString = dataCheckString.slice(0, -1);

    // إنشاء المفتاح السري
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    
    // حساب الهاش
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    return calculatedHash === hash;
  } catch (error) {
    console.error('❌ Error in validateTelegramWebAppData:', error);
    return false;
  }
}

export function parseInitData(initData: string): any | null {
  try {
    const urlParams = new URLSearchParams(initData);
    const userStr = urlParams.get('user');
    
    if (!userStr) return null;
    
    // ملاحظة: تليجرام يرسل user كـ JSON مشفر URI أحياناً
    // نحاول فك التشفير أولاً ثم التحليل
    let decodedUserStr = userStr;
    try {
      decodedUserStr = decodeURIComponent(userStr);
    } catch (e) {
      // إذا فشل فك التشفير، نجرب النص الأصلي
    }

    return JSON.parse(decodedUserStr);
  } catch (error) {
    console.error('❌ Error in parseInitData:', error);
    return null;
  }
}
