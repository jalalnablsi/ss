'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useGame } from './GameProvider';
import { Zap, BatteryCharging, Bot, PlaySquare, Loader2, Coins, Clock, AlertTriangle } from 'lucide-react';

export function BoostsScreen() {
  const { 
    watchAdForMultiplier, 
    watchAdForEnergy, 
    watchAdForBot,
    tapMultiplierEndTime,
    autoBotActiveUntil,
    adsWatchedToday,
    isWatchingAd,
    tapMultiplier,
    energy,
    maxEnergy,
    adProtection,
    checkAdEligibility
  } = useGame();

  const [loadingBoostId, setLoadingBoostId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [localCooldown, setLocalCooldown] = useState(0);
  const [isVisible, setIsVisible] = useState(true);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const visibilityCheckRef = useRef<NodeJS.Timeout | null>(null);

  // Handle visibility change
  useEffect(() => {
    const handleVisibilityChange = () => {
      const visible = document.visibilityState === 'visible';
      setIsVisible(visible);
      
      if (visible) {
        // Refresh data when becoming visible
        checkAdEligibility();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Initial check
    checkAdEligibility();
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [checkAdEligibility]);

  // Update timer every second
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setNow(Date.now());
      setLocalCooldown(prev => {
        if (prev > 0) {
          return prev - 1;
        }
        return 0;
      });
    }, 1000);
    
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  // Sync local cooldown with server data
  useEffect(() => {
    if (adProtection?.waitSeconds && adProtection.waitSeconds > 0) {
      setLocalCooldown(adProtection.waitSeconds);
    } else if (adProtection?.nextAdInSeconds && adProtection.nextAdInSeconds > 0) {
      setLocalCooldown(adProtection.nextAdInSeconds);
    }
  }, [adProtection?.waitSeconds, adProtection?.nextAdInSeconds]);

  // Periodic refresh when visible
  useEffect(() => {
    if (isVisible) {
      visibilityCheckRef.current = setInterval(() => {
        checkAdEligibility();
      }, 10000); // Refresh every 10 seconds when visible
    }
    
    return () => {
      if (visibilityCheckRef.current) {
        clearInterval(visibilityCheckRef.current);
      }
    };
  }, [isVisible, checkAdEligibility]);

  const isMultiplierActive = tapMultiplierEndTime > now;
  const isBotActive = autoBotActiveUntil > now;
  const isEnergyFull = energy >= maxEnergy;

  // Use local cooldown or server value
  const effectiveWaitSeconds = localCooldown > 0 
    ? localCooldown 
    : (adProtection?.nextAdInSeconds || adProtection?.waitSeconds || 0);
  
  const canWatchAd = adProtection?.isAllowed && effectiveWaitSeconds === 0;

  // Calculate ads watched (not remaining)
  const adsWatchedCount = adProtection ? (30 - adProtection.remainingToday) : adsWatchedToday;
  const adsRemainingToday = adProtection?.remainingToday ?? (30 - adsWatchedToday);
  const adsRemainingThisHour = adProtection?.remainingThisHour ?? 5;

  const formatTimeLeft = (endTime: number) => {
    const diff = Math.max(0, endTime - now);
    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const formatHoursLeft = (endTime: number) => {
    const diff = Math.max(0, endTime - now);
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    return `${hours}h ${minutes}m`;
  };

  const formatWaitTime = (seconds: number) => {
    if (seconds <= 0) return 'Ready';
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs.toString().padStart(2, '0')}s`;
  };

  const handleWatchAd = useCallback(async (id: string, action: () => Promise<void>) => {
    if (!canWatchAd && effectiveWaitSeconds > 0) {
      return;
    }
    
    setLoadingBoostId(id);
    await action();
    // Refresh immediately after watching
    await checkAdEligibility();
    setLoadingBoostId(null);
  }, [canWatchAd, effectiveWaitSeconds, checkAdEligibility]);

  const boosts = [
    {
      id: 'multiplier',
      title: 'Quad Strike (x4)',
      description: 'Multiply your earnings 4 times for 5 minutes. +1000 instant coins!',
      subDescription: 'Gives you 4x tap power + instant coin bonus.',
      icon: <Zap size={28} className="text-orange-400" />,
      color: 'from-orange-500/20 to-red-500/20',
      borderColor: 'border-orange-500/30',
      action: watchAdForMultiplier,
      isActive: isMultiplierActive,
      statusText: isMultiplierActive ? `Active (${formatTimeLeft(tapMultiplierEndTime)})` : 'Available',
      buttonText: isMultiplierActive ? 'Working...' : 'Watch Ad',
      disabled: isMultiplierActive || isWatchingAd || !canWatchAd || effectiveWaitSeconds > 0,
      instantReward: '+1000 Coins',
      bonusReward: 'x4 Taps for 5 minutes',
      rewardIcon: <Zap size={12} className="text-orange-400" />
    },
    {
      id: 'energy',
      title: 'Full Energy Refill',
      description: 'Restore your energy instantly. +1000 instant coins!',
      subDescription: 'Energy bar refills to max + instant coin bonus.',
      icon: <BatteryCharging size={28} className="text-green-400" />,
      color: 'from-green-500/20 to-emerald-500/20',
      borderColor: 'border-green-500/30',
      action: watchAdForEnergy,
      isActive: false,
      statusText: isEnergyFull ? 'Energy Full' : 'Available',
      buttonText: 'Watch Ad',
      disabled: isEnergyFull || isWatchingAd || !canWatchAd || effectiveWaitSeconds > 0,
      instantReward: '+1000 Coins',
      bonusReward: 'Full Energy Instantly',
      rewardIcon: <BatteryCharging size={12} className="text-green-400" />
    },
    {
      id: 'autobot',
      title: 'Auto-Tap Bot',
      description: 'Bot works automatically for 6 hours. +1000 instant coins!',
      subDescription: 'Collect coins even when you are offline.',
      icon: <Bot size={28} className="text-blue-400" />,
      color: 'from-blue-500/20 to-cyan-500/20',
      borderColor: 'border-blue-500/30',
      action: watchAdForBot,
      isActive: isBotActive,
      statusText: isBotActive ? `Active (${formatHoursLeft(autoBotActiveUntil)})` : `${adsWatchedCount}/30 Today`,
      buttonText: isBotActive ? 'Working...' : 'Watch Ad',
      disabled: isBotActive || isWatchingAd || !canWatchAd || effectiveWaitSeconds > 0,
      instantReward: '+1000 Coins',
      bonusReward: 'Auto Bot for 6 Hours',
      rewardIcon: <Bot size={12} className="text-blue-400" />
    }
  ];

  // Calculate progress percentage correctly
  const progressPercentage = Math.min(100, Math.max(0, (adsWatchedCount / 30) * 100));

  // Show loading state if no adProtection data yet
  if (!adProtection) {
    return (
      <div className="w-full h-full flex items-center justify-center pb-28">
        <Loader2 className="animate-spin text-yellow-500" size={48} />
      </div>
    );
  }

  return (
    <div className="w-full h-full pb-28 pt-8 px-5 overflow-y-auto">
      <div className="text-center mb-10">
        <h2 className="text-4xl font-black text-white mb-3 tracking-tight">Boosts</h2>
        <p className="text-zinc-400 text-sm">Watch short ads and get instant rewards and powerful features!</p>
      </div>

      {/* Ad Status Card */}
      <div className="mb-6 bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-zinc-400">Daily Ads Watched</span>
          <span className="text-sm font-bold text-white">{adsWatchedCount} / 30</span>
        </div>
        
        {/* Progress Bar */}
        <div className="w-full bg-white/10 rounded-full h-2 mb-3 overflow-hidden">
          <div 
            className={`h-2 rounded-full transition-all duration-500 ${
              adsWatchedCount >= 30 
                ? 'bg-red-500' 
                : adsWatchedCount >= 25 
                  ? 'bg-orange-500' 
                  : 'bg-gradient-to-r from-blue-500 to-cyan-500'
            }`}
            style={{ width: `${progressPercentage}%` }}
          />
        </div>
        
        <div className="flex items-center justify-between text-xs mb-2">
          <span className="text-zinc-500">
            This Hour: {Math.max(0, 5 - adsRemainingThisHour)} / 5 watched
          </span>
          <span className={`font-medium ${
            adsRemainingToday <= 5 ? 'text-red-400' : 'text-zinc-400'
          }`}>
            {adsRemainingToday} remaining today
          </span>
        </div>

        {/* Countdown Timer */}
        {effectiveWaitSeconds > 0 && (
          <div className="mt-3 pt-3 border-t border-white/10 flex items-center justify-between">
            <span className="text-xs text-orange-400 flex items-center gap-1">
              <Clock size={12} />
              Next ad available in:
            </span>
            <span className="text-sm font-bold text-orange-300 font-mono">
              {formatWaitTime(effectiveWaitSeconds)}
            </span>
          </div>
        )}
      </div>

      {/* Cooldown Warning */}
      {effectiveWaitSeconds > 0 && (
        <div className="mb-6 bg-orange-500/10 border border-orange-500/30 rounded-2xl p-4 flex items-center gap-3 animate-pulse">
          <AlertTriangle size={24} className="text-orange-400 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-orange-300">Cooldown Active</p>
            <p className="text-xs text-orange-400/70">
              Please wait {formatWaitTime(effectiveWaitSeconds)} before watching another ad
            </p>
          </div>
          <div className="text-right">
            <span className="text-lg font-bold text-orange-400 font-mono">
              {formatWaitTime(effectiveWaitSeconds)}
            </span>
          </div>
        </div>
      )}

      {/* Daily Limit Reached Warning */}
      {adsRemainingToday <= 0 && (
        <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-2xl p-4 flex items-center gap-3">
          <AlertTriangle size={24} className="text-red-400 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-300">Daily Limit Reached</p>
            <p className="text-xs text-red-400/70">
              You have watched all 30 ads for today. Come back tomorrow!
            </p>
          </div>
        </div>
      )}

      <div className="space-y-5">
        {boosts.map((boost) => {
          const isLoading = loadingBoostId === boost.id;
          const isDisabled = boost.disabled;

          return (
            <div 
              key={boost.id}
              className={`bg-white/5 backdrop-blur-xl border ${boost.borderColor} rounded-3xl p-5 flex flex-col gap-4 relative overflow-hidden shadow-lg transition-all duration-300 ${
                isDisabled ? 'opacity-60' : 'hover:bg-white/[0.07]'
              }`}
            >
              <div className={`absolute -top-10 -right-10 w-40 h-40 bg-gradient-to-br ${boost.color} blur-3xl opacity-40 pointer-events-none`} />
              
              <div className="flex items-start gap-5 relative z-10">
                <div className="w-14 h-14 rounded-2xl bg-black/40 border border-white/10 flex items-center justify-center shrink-0 shadow-inner">
                  {boost.icon}
                </div>
                <div className="flex-1">
                  <div className="flex justify-between items-start mb-1.5">
                    <h3 className="font-bold text-xl text-white tracking-tight">{boost.title}</h3>
                    <span className={`text-[10px] font-bold px-2.5 py-1 rounded-lg uppercase tracking-wider ${
                      boost.isActive 
                        ? 'bg-green-500/20 text-green-400 border border-green-500/30 animate-pulse' 
                        : 'bg-white/10 text-zinc-300'
                    }`}>
                      {boost.statusText}
                    </span>
                  </div>
                  <p className="text-sm text-zinc-300 leading-relaxed font-medium">
                    {boost.description}
                  </p>
                  <p className="text-xs text-zinc-500 mt-1">
                    {boost.subDescription}
                  </p>
                  
                  <div className="mt-4 space-y-2">
                    <div className="flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/20 px-3 py-2 rounded-lg">
                      <Coins size={14} className="text-yellow-400" />
                      <div className="flex flex-col">
                        <span className="text-[10px] text-yellow-400 font-bold uppercase">Instant Reward</span>
                        <span className="text-xs text-yellow-300 font-semibold">{boost.instantReward}</span>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2 bg-white/5 border border-white/10 px-3 py-2 rounded-lg">
                      {boost.rewardIcon}
                      <div className="flex flex-col">
                        <span className="text-[10px] text-zinc-400 font-bold uppercase">Bonus Reward</span>
                        <span className="text-xs text-zinc-200 font-semibold">{boost.bonusReward}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <button
                onClick={() => handleWatchAd(boost.id, boost.action)}
                disabled={isDisabled}
                className={`w-full py-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all duration-300 ${
                  isDisabled 
                    ? 'bg-black/40 text-zinc-600 cursor-not-allowed border border-white/5' 
                    : 'bg-white text-black hover:bg-zinc-200 active:scale-[0.98] shadow-[0_0_20px_rgba(255,255,255,0.2)]'
                }`}
              >
                {isLoading ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  !isDisabled && <PlaySquare size={18} />
                )}
                {isLoading ? 'Loading...' : effectiveWaitSeconds > 0 ? `Wait ${formatWaitTime(effectiveWaitSeconds)}` : boost.buttonText}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
