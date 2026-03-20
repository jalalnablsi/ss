// lib/adProtection.ts
// Advanced Ad Protection System - Progressive Cooldown & Anti-Fraud

import { queryD1, executeD1 } from './db';

export interface AdProtectionConfig {
  maxAdsPerDay: number;
  maxAdsPerHour: number;
  cooldownTiers: number[];
}

export interface AdWatchRecord {
  id: string;
  telegram_id: string;
  ad_type: string;
  watched_at: number;
  hour_bucket: number;
  date_str: string;
  reward_given: number;
}

export interface AdProtectionResult {
  allowed: boolean;
  reason?: string;
  nextAllowedAt?: number;
  remainingToday: number;
  remainingThisHour: number;
  currentTier: number;
  waitSeconds: number;
  adsWatchedToday: number; // ✅ إضافة: العدد الفعلي من السيرفر
}

export const DEFAULT_PROTECTION_CONFIG: AdProtectionConfig = {
  maxAdsPerDay: 30,
  maxAdsPerHour: 5,
  cooldownTiers: [30, 60, 300, 600, 900], // 30s, 1m, 5m, 10m, 15m
};

// ✅ إصلاح: مصدر واحد للحقيقة - قاعدة البيانات فقط
export async function checkAdEligibility(
  telegramId: string,
  config: AdProtectionConfig = DEFAULT_PROTECTION_CONFIG
): Promise<AdProtectionResult> {
  const now = Date.now();
  const todayStr = new Date(now).toISOString().split('T')[0];
  const currentHour = new Date(now).getHours();

  try {
    // ✅ قراءة العداد مباشرة من قاعدة البيانات (مصدر الحقيقة الوحيد)
    const userResult = await queryD1<{ ads_watched_today: number; last_ad_watch_date: string }>(
      `SELECT ads_watched_today, last_ad_watch_date 
       FROM users 
       WHERE telegram_id = ?`,
      [telegramId]
    );
    
    const user = userResult[0];
    let adsWatchedToday = 0;
    
    // ✅ التحقق من أن العداد لليوم الحالي فقط
    if (user && user.last_ad_watch_date) {
      const lastDate = user.last_ad_watch_date.includes('T') 
        ? user.last_ad_watch_date.split('T')[0]
        : new Date(user.last_ad_watch_date).toISOString().split('T')[0];
      
      if (lastDate === todayStr) {
        adsWatchedToday = user.ads_watched_today || 0;
      }
    }

    // ✅ قراءة سجلات اليوم من ad_watch_logs للتحقق من الساعة
    const todayLogs = await queryD1<AdWatchRecord>(
      `SELECT watched_at, hour_bucket 
       FROM ad_watch_logs 
       WHERE telegram_id = ? AND date_str = ? AND ad_type != 'VIOLATION'
       ORDER BY watched_at DESC
       LIMIT 50`,
      [telegramId, todayStr]
    );

    const adsThisHour = todayLogs.filter(log => log.hour_bucket === currentHour).length;

    // ✅ التحقق من الحد اليومي (30 إعلان)
    if (adsWatchedToday >= config.maxAdsPerDay) {
      return {
        allowed: false,
        reason: 'DAILY_LIMIT_REACHED',
        remainingToday: 0,
        remainingThisHour: Math.max(0, config.maxAdsPerHour - adsThisHour),
        currentTier: config.cooldownTiers.length - 1,
        waitSeconds: 0,
        adsWatchedToday,
      };
    }

    // ✅ التحقق من الحد الساعي (5 إعلانات)
    if (adsThisHour >= config.maxAdsPerHour) {
      const nextHour = new Date(now);
      nextHour.setHours(currentHour + 1, 0, 0, 0);

      return {
        allowed: false,
        reason: 'HOURLY_LIMIT_REACHED',
        nextAllowedAt: nextHour.getTime(),
        remainingToday: config.maxAdsPerDay - adsWatchedToday,
        remainingThisHour: 0,
        currentTier: config.cooldownTiers.length - 1,
        waitSeconds: Math.ceil((nextHour.getTime() - now) / 1000),
        adsWatchedToday,
      };
    }

    // ✅ حساب فترة الانتظار (Cooldown)
    let waitSeconds = 0;
    let currentTier = 0;

    if (todayLogs.length > 0) {
      const lastAd = todayLogs[0];
      const timeSinceLastAd = now - lastAd.watched_at;
      const oneHourAgo = now - (60 * 60 * 1000);
      const recentAds = todayLogs.filter(log => log.watched_at > oneHourAgo).length;

      currentTier = Math.min(recentAds, config.cooldownTiers.length - 1);
      waitSeconds = config.cooldownTiers[currentTier];

      if (timeSinceLastAd < waitSeconds * 1000) {
        const remainingWait = Math.ceil((waitSeconds * 1000 - timeSinceLastAd) / 1000);

        return {
          allowed: false,
          reason: 'COOLDOWN_ACTIVE',
          nextAllowedAt: lastAd.watched_at + (waitSeconds * 1000),
          remainingToday: config.maxAdsPerDay - adsWatchedToday,
          remainingThisHour: config.maxAdsPerHour - adsThisHour,
          currentTier,
          waitSeconds: remainingWait,
          adsWatchedToday,
        };
      }
    }

    return {
      allowed: true,
      remainingToday: config.maxAdsPerDay - adsWatchedToday - 1,
      remainingThisHour: config.maxAdsPerHour - adsThisHour - 1,
      currentTier,
      waitSeconds: 0,
      adsWatchedToday,
    };
  } catch (error) {
    console.error('Error in checkAdEligibility:', error);
    return {
      allowed: false,
      reason: 'SYSTEM_ERROR',
      remainingToday: 0,
      remainingThisHour: 0,
      currentTier: 0,
      waitSeconds: 60,
      adsWatchedToday: 0,
    };
  }
}

// ✅ إصلاح: تسجيل الإعلان مرة واحدة فقط
export async function logAdWatch(
  telegramId: string,
  adType: 'multiplier' | 'energy' | 'bot' | 'VIOLATION',
  rewardGiven: number = 1000,
  ipAddress?: string,
  userAgent?: string
): Promise<{ success: boolean; newCount: number }> {
  const now = Date.now();
  const todayStr = new Date(now).toISOString().split('T')[0];
  const currentHour = new Date(now).getHours();
  const id = crypto.randomUUID();

  // ✅ استخدام Transaction لضمان التسجيل مرة واحدة
  await executeD1(
    `INSERT INTO ad_watch_logs 
     (id, telegram_id, ad_type, watched_at, hour_bucket, date_str, reward_given, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, telegramId, adType, now, currentHour, todayStr, rewardGiven, ipAddress || null, userAgent || null]
  );

  // ✅ تحديث العداد مباشرة (بدون قراءة سابقة لتجنب race condition)
  const updateResult = await executeD1(
    `UPDATE users SET 
      ads_watched_today = CASE 
        WHEN last_ad_watch_date = ? THEN ads_watched_today + 1
        ELSE 1
      END,
      last_ad_watch_date = ?
     WHERE telegram_id = ?
     RETURNING ads_watched_today`,
    [todayStr, todayStr, telegramId]
  );

  const newCount = updateResult.results?.[0]?.ads_watched_today || 0;
  
  return { success: true, newCount };
}

// ✅ إصلاح: إحصائيات دقيقة من السيرفر فقط
export async function getUserAdStats(telegramId: string) {
  const now = Date.now();
  const todayStr = new Date(now).toISOString().split('T')[0];
  const currentHour = new Date(now).getHours();

  // ✅ قراءة العداد من المستخدم
  const userResult = await queryD1<{ ads_watched_today: number; last_ad_watch_date: string }>(
    `SELECT ads_watched_today, last_ad_watch_date 
     FROM users 
     WHERE telegram_id = ?`,
    [telegramId]
  );
  
  let adsWatchedToday = 0;
  if (userResult[0]?.last_ad_watch_date) {
    const lastDate = userResult[0].last_ad_watch_date.includes('T')
      ? userResult[0].last_ad_watch_date.split('T')[0]
      : new Date(userResult[0].last_ad_watch_date).toISOString().split('T')[0];
    
    if (lastDate === todayStr) {
      adsWatchedToday = userResult[0].ads_watched_today || 0;
    }
  }

  // ✅ قراءة السجلات للتحقق من الساعة والـ Cooldown
  const todayLogs = await queryD1<AdWatchRecord>(
    `SELECT watched_at, hour_bucket 
     FROM ad_watch_logs 
     WHERE telegram_id = ? AND date_str = ? AND ad_type != 'VIOLATION'
     ORDER BY watched_at DESC
     LIMIT 20`,
    [telegramId, todayStr]
  );

  const adsThisHour = todayLogs.filter(log => log.hour_bucket === currentHour).length;
  const lastAd = todayLogs[0] || null;

  // حساب وقت الانتظار
  let nextAdInSeconds = 0;
  if (lastAd) {
    const config = DEFAULT_PROTECTION_CONFIG;
    const oneHourAgo = now - (60 * 60 * 1000);
    const recentAds = todayLogs.filter(log => log.watched_at > oneHourAgo).length;
    
    const tier = Math.min(recentAds, config.cooldownTiers.length - 1);
    const requiredWait = config.cooldownTiers[tier] * 1000;
    const timePassed = now - lastAd.watched_at;

    if (timePassed < requiredWait) {
      nextAdInSeconds = Math.ceil((requiredWait - timePassed) / 1000);
    }
  }

  return {
    totalToday: adsWatchedToday, // ✅ من قاعدة البيانات مباشرة
    thisHour: adsThisHour,
    remainingToday: Math.max(0, 30 - adsWatchedToday),
    remainingThisHour: Math.max(0, 5 - adsThisHour),
    lastAdAt: lastAd?.watched_at || null,
    nextAdInSeconds,
    history: todayLogs.slice(0, 5),
  };
}

export async function detectSuspiciousActivity(telegramId: string): Promise<{
  isSuspicious: boolean;
  reason?: string;
}> {
  const now = Date.now();
  const fiveMinutesAgo = now - (5 * 60 * 1000);

  const countResult = await queryD1<{ count: number }>(
    `SELECT COUNT(*) as count 
     FROM ad_watch_logs 
     WHERE telegram_id = ? AND watched_at > ? AND ad_type != 'VIOLATION'`,
    [telegramId, fiveMinutesAgo]
  );

  const recentCount = countResult[0]?.count || 0;

  if (recentCount > 5) {
    return {
      isSuspicious: true,
      reason: `RAPID_AD_WATCHING: ${recentCount} ads in 5 minutes`,
    };
  }

  if (recentCount > 3) {
    const recentLogs = await queryD1<AdWatchRecord>(
      `SELECT watched_at 
       FROM ad_watch_logs 
       WHERE telegram_id = ? AND watched_at > ? AND ad_type != 'VIOLATION'
       ORDER BY watched_at DESC
       LIMIT 5`,
      [telegramId, fiveMinutesAgo]
    );

    for (let i = 0; i < recentLogs.length - 1; i++) {
      const diff = recentLogs[i].watched_at - recentLogs[i + 1].watched_at;
      if (diff < 15000) {
        return {
          isSuspicious: true,
          reason: `IMPOSSIBLE_AD_SPEED: ${(diff / 1000).toFixed(3)} seconds between ads`,
        };
      }
    }
  }

  return { isSuspicious: false };
}

export async function recordViolation(
  telegramId: string,
  violationType: string
): Promise<{ isBanned: boolean; banUntil?: number }> {
  const now = Date.now();
  const todayStr = new Date(now).toISOString().split('T')[0];
  
  await logAdWatch(
    telegramId,
    'VIOLATION',
    0,
    undefined,
    violationType
  );
  
  const violations = await queryD1<{ count: number }>(
    `SELECT COUNT(*) as count 
     FROM ad_watch_logs 
     WHERE telegram_id = ? AND date_str = ? AND ad_type = 'VIOLATION'`,
    [telegramId, todayStr]
  );
  
  const violationCount = violations[0]?.count || 0;
  
  if (violationCount >= 3) {
    const banUntil = now + (24 * 60 * 60 * 1000);
    return { isBanned: true, banUntil };
  }
  
  return { isBanned: false };
}
