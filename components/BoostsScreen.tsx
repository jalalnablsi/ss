'use client';

import React, { useState, useEffect } from 'react';
import { useGame } from './GameProvider';
import { Zap, BatteryCharging, Bot, PlaySquare, Loader2 } from 'lucide-react';

export function BoostsScreen() {
  const { 
    watchAdForMultiplier, 
    watchAdForEnergy, 
    watchAdForBot,
    tapMultiplierEndTime,
    autoBotActiveUntil,
    adsWatchedToday,
    isWatchingAd
  } = useGame();

  const [loadingBoostId, setLoadingBoostId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const isMultiplierActive = tapMultiplierEndTime > now;
  const isBotActive = autoBotActiveUntil > now;

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

  const handleWatchAd = async (id: string, action: () => Promise<void>) => {
    setLoadingBoostId(id);
    await action();
    setLoadingBoostId(null);
  };

  const boosts = [
    {
      id: 'multiplier',
      title: 'Quad Strike (x4)',
      description: 'Get 4x coins for every tap for the next 5 minutes.',
      icon: <Zap size={28} className="text-orange-400" />,
      color: 'from-orange-500/20 to-red-500/20',
      borderColor: 'border-orange-500/30',
      action: watchAdForMultiplier,
      isActive: isMultiplierActive,
      statusText: isMultiplierActive ? `Active (${formatTimeLeft(tapMultiplierEndTime)})` : 'Available',
      buttonText: isMultiplierActive ? 'Running' : 'Watch Ad',
      disabled: isMultiplierActive,
    },
    {
      id: 'energy',
      title: 'Full Energy Refill',
      description: 'Instantly restore your energy to 500 to keep tapping.',
      icon: <BatteryCharging size={28} className="text-green-400" />,
      color: 'from-green-500/20 to-emerald-500/20',
      borderColor: 'border-green-500/30',
      action: watchAdForEnergy,
      isActive: false,
      statusText: 'Available',
      buttonText: 'Watch Ad',
    },
    {
      id: 'autobot',
      title: 'Auto-Tap Bot',
      description: 'Collects coins automatically for 6 hours (even offline). Requires 3 ads daily.',
      icon: <Bot size={28} className="text-blue-400" />,
      color: 'from-blue-500/20 to-cyan-500/20',
      borderColor: 'border-blue-500/30',
      action: watchAdForBot,
      isActive: isBotActive,
      statusText: isBotActive ? `Active (${formatHoursLeft(autoBotActiveUntil)})` : `${adsWatchedToday}/3 Ads`,
      buttonText: isBotActive ? 'Running' : 'Watch Ad',
      disabled: isBotActive,
    }
  ];

  return (
    <div className="w-full h-full pb-28 pt-8 px-5 overflow-y-auto">
      <div className="text-center mb-10">
        <h2 className="text-4xl font-black text-white mb-3 tracking-tight">Boosts</h2>
        <p className="text-zinc-400 text-sm">Watch short ads to unlock powerful features and multiply your earnings!</p>
      </div>

      <div className="space-y-5">
        {boosts.map((boost) => {
          const isLoading = loadingBoostId === boost.id;
          const isDisabled = boost.disabled || isWatchingAd;

          return (
            <div 
              key={boost.id}
              className={`bg-white/5 backdrop-blur-xl border ${boost.borderColor} rounded-3xl p-5 flex flex-col gap-5 relative overflow-hidden shadow-lg`}
            >
              <div className={`absolute -top-10 -right-10 w-40 h-40 bg-gradient-to-br ${boost.color} blur-3xl opacity-40 pointer-events-none`} />
              
              <div className="flex items-start gap-5 relative z-10">
                <div className="w-14 h-14 rounded-2xl bg-black/40 border border-white/10 flex items-center justify-center shrink-0 shadow-inner">
                  {boost.icon}
                </div>
                <div className="flex-1">
                  <div className="flex justify-between items-start mb-1.5">
                    <h3 className="font-bold text-xl text-white tracking-tight">{boost.title}</h3>
                    <span className={`text-[10px] font-bold px-2.5 py-1 rounded-lg uppercase tracking-wider ${boost.isActive ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-white/10 text-zinc-300'}`}>
                      {boost.statusText}
                    </span>
                  </div>
                  <p className="text-sm text-zinc-400 leading-relaxed">
                    {boost.description}
                  </p>
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
                  !boost.disabled && <PlaySquare size={18} />
                )}
                {isLoading ? 'Loading Ad...' : boost.buttonText}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
