// lib/adProtection.ts
// نظام حماية متدرج للإعلانات - يمنع السكام ويحمي من حظر شركة الإعلانات

import { queryD1, executeD1 } from './db';

export interface AdProtectionConfig {
  maxAdsPerDay: number;
  maxAdsPerHour: number;
  cooldownTiers: number[];
  maxQuickRewards: number;
}

export interface AdWatchRecord {
  id: string;
  telegram_id: string;
  ad_type: string;
  watched_at: number;
  hour_bucket: number;
  date_str: string;
}

export interface AdProtectionResult {
  allowed: boolean;
  reason?: string;
  nextAllowedAt?: number;
  remainingToday: number;
  remainingThisHour: number;
  currentTier: number;
  waitSeconds: number;
}

export const DEFAULT_PROTECTION_CONFIG: AdProtectionConfig = {
  maxAdsPerDay: 30,
  maxAdsPerHour: 5,
  cooldownTiers: [30, 60, 300, 600, 900],
  maxQuickRewards: 3,
};

export async function checkAdEligibility(
  telegramId: string,
  config: AdProtectionConfig = DEFAULT_PROTECTION_CONFIG
): Promise<AdProtectionResult> {
  const now = Date.now();
  const todayStr = new Date(now).toISOString().split('T')[0];
  const currentHour = new Date(now).getHours();

  const todayLogs = await queryD1<AdWatchRecord>(
    `SELECT * FROM ad_watch_logs 
     WHERE telegram_id = ? AND date_str = ? 
     ORDER BY watched_at DESC`,
    [telegramId, todayStr]
  );

  const adsToday = todayLogs.length;
  const adsThisHour = todayLogs.filter(log => log.hour_bucket === currentHour).length;

  if (adsToday >= config.maxAdsPerDay) {
    return {
      allowed: false,
      reason: 'DAILY_LIMIT_REACHED',
      remainingToday: 0,
      remainingThisHour: Math.max(0, config.maxAdsPerHour - adsThisHour),
      currentTier: config.cooldownTiers.length - 1,
      waitSeconds: 0,
    };
  }

  if (adsThisHour >= config.maxAdsPerHour) {
    const nextHour = new Date(now);
    nextHour.setHours(currentHour + 1, 0, 0, 0);

    return {
      allowed: false,
      reason: 'HOURLY_LIMIT_REACHED',
      nextAllowedAt: nextHour.getTime(),
      remainingToday: config.maxAdsPerDay - adsToday,
      remainingThisHour: 0,
      currentTier: config.cooldownTiers.length - 1,
      waitSeconds: Math.ceil((nextHour.getTime() - now) / 1000),
    };
  }

  let waitSeconds = 0;
  let currentTier = 0;

  if (todayLogs.length > 0) {
    const lastAd = todayLogs[0];
    const timeSinceLastAd = now - lastAd.watched_at;
    const recentAds = todayLogs.filter(log => 
      log.watched_at > now - (60 * 60 * 1000)
    ).length;

    if (recentAds === 0) {
      currentTier = 0;
      waitSeconds = config.cooldownTiers[0];
    } else if (recentAds === 1) {
      currentTier = 1;
      waitSeconds = config.cooldownTiers[1];
    } else if (recentAds === 2) {
      currentTier = 2;
      waitSeconds = config.cooldownTiers[2];
    } else if (recentAds === 3) {
      currentTier = 3;
      waitSeconds = config.cooldownTiers[3];
    } else {
      currentTier = 4;
      waitSeconds = config.cooldownTiers[4];
    }

    if (timeSinceLastAd < waitSeconds * 1000) {
      const remainingWait = Math.ceil((waitSeconds * 1000 - timeSinceLastAd) / 1000);

      return {
        allowed: false,
        reason: 'COOLDOWN_ACTIVE',
        nextAllowedAt: lastAd.watched_at + (waitSeconds * 1000),
        remainingToday: config.maxAdsPerDay - adsToday,
        remainingThisHour: config.maxAdsPerHour - adsThisHour,
        currentTier,
        waitSeconds: remainingWait,
      };
    }
  }

  return {
    allowed: true,
    remainingToday: config.maxAdsPerDay - adsToday - 1,
    remainingThisHour: config.maxAdsPerHour - adsThisHour - 1,
    currentTier,
    waitSeconds: 0,
  };
}

export async function logAdWatch(
  telegramId: string,
  adType: 'multiplier' | 'energy' | 'bot',
  rewardGiven: number = 1000,
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  const now = Date.now();
  const todayStr = new Date(now).toISOString().split('T')[0];
  const currentHour = new Date(now).getHours();
  const id = crypto.randomUUID();

  await executeD1(
    `INSERT INTO ad_watch_logs 
     (id, telegram_id, ad_type, watched_at, hour_bucket, date_str, reward_given, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, telegramId, adType, now, currentHour, todayStr, rewardGiven, ipAddress || null, userAgent || null]
  );

  await executeD1(
    `UPDATE users SET 
      ads_watched_today = ads_watched_today + 1,
      last_ad_watch_date = ?
     WHERE telegram_id = ?`,
    [todayStr, telegramId]
  );
}

export async function getUserAdStats(telegramId: string) {
  const now = Date.now();
  const todayStr = new Date(now).toISOString().split('T')[0];
  const currentHour = new Date(now).getHours();

  const todayLogs = await queryD1<AdWatchRecord>(
    `SELECT * FROM ad_watch_logs 
     WHERE telegram_id = ? AND date_str = ? 
     ORDER BY watched_at DESC`,
    [telegramId, todayStr]
  );

  const lastAd = todayLogs[0] || null;
  const adsThisHour = todayLogs.filter(log => log.hour_bucket === currentHour).length;

  let nextAdInSeconds = 0;
  if (lastAd) {
    const config = DEFAULT_PROTECTION_CONFIG;
    const recentAds = todayLogs.filter(log => 
      log.watched_at > now - (60 * 60 * 1000)
    ).length;

    const tier = Math.min(recentAds, config.cooldownTiers.length - 1);
    const requiredWait = config.cooldownTiers[tier] * 1000;
    const timePassed = now - lastAd.watched_at;

    if (timePassed < requiredWait) {
      nextAdInSeconds = Math.ceil((requiredWait - timePassed) / 1000);
    }
  }

  return {
    totalToday: todayLogs.length,
    thisHour: adsThisHour,
    remainingToday: Math.max(0, 30 - todayLogs.length),
    remainingThisHour: Math.max(0, 5 - adsThisHour),
    lastAdAt: lastAd?.watched_at || null,
    nextAdInSeconds,
    history: todayLogs.slice(0, 10),
  };
}

export async function detectSuspiciousActivity(telegramId: string): Promise<{
  isSuspicious: boolean;
  reason?: string;
}> {
  const now = Date.now();
  const fiveMinutesAgo = now - (5 * 60 * 1000);

  const recentLogs = await queryD1<AdWatchRecord>(
    `SELECT * FROM ad_watch_logs 
     WHERE telegram_id = ? AND watched_at > ? 
     ORDER BY watched_at DESC`,
    [telegramId, fiveMinutesAgo]
  );

  if (recentLogs.length > 5) {
    return {
      isSuspicious: true,
      reason: 'RAPID_AD_WATCHING: ' + recentLogs.length + ' ads in 5 minutes',
    };
  }

  for (let i = 0; i < recentLogs.length - 1; i++) {
    const diff = recentLogs[i].watched_at - recentLogs[i + 1].watched_at;
    if (diff < 10000) {
      return {
        isSuspicious: true,
        reason: 'IMPOSSIBLE_AD_SPEED: ' + (diff / 1000) + ' seconds between ads',
      };
    }
  }

  return { isSuspicious: false };
}
