'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Trophy, Crown, Loader2, Timer } from 'lucide-react';
import { useGame } from './GameProvider';

type LeaderboardPeriod = 'all_time' | 'challenge';

interface LeaderboardUser {
  id: string;
  name: string;
  coins: number;
  rank: number;
}

interface ActiveChallenge {
  id: string;
  title: string;
  start_time: number;
  end_time: number;
  is_active: number;
}

export function LeaderboardScreen() {
  const { coins, challengeCoins } = useGame();
  const [period, setPeriod] = useState<LeaderboardPeriod>('all_time');
  const [leaderboard, setLeaderboard] = useState<LeaderboardUser[]>([]);
  const [activeChallenge, setActiveChallenge] = useState<ActiveChallenge | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [timeLeft, setTimeLeft] = useState<string>('');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
      setCurrentUserId(tgUser?.id?.toString() || null);
    }
  }, []);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(`/api/leaderboard?period=${period}`);
        if (response.ok) {
          const data = await response.json();
          setLeaderboard(data.leaderboard || []);
          setActiveChallenge(data.activeChallenge || null);
        }
      } catch (error) {
        console.error('Failed to fetch leaderboard:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchLeaderboard();
  }, [period]);

  useEffect(() => {
    if (!activeChallenge || period !== 'challenge') return;

    const updateTimer = () => {
      const now = Date.now();
      const diff = activeChallenge.end_time - now;

      if (diff <= 0) {
        setTimeLeft('Challenge Ended');
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      setTimeLeft(`${days}d ${hours}h ${minutes}m ${seconds}s`);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [activeChallenge, period]);

  const currentUserInTop50 = useMemo(() => 
    leaderboard.find(u => u.id === currentUserId),
  [leaderboard, currentUserId]);

  const displayList = useMemo(() => {
    const list = [...leaderboard];
    if (!currentUserInTop50 && currentUserId) {
      list.push({
        id: currentUserId,
        name: 'You',
        coins: period === 'challenge' ? (challengeCoins || 0) : coins,
        rank: 0,
      });
    }
    return list;
  }, [leaderboard, currentUserId, currentUserInTop50, period, challengeCoins, coins]);

  // ✅ الحل: استخدام 'en-US' لضمان الأرقام الإنجليزية
  const formatCoins = (num: number) => {
    if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toLocaleString('en-US');
  };

  return (
    <div className="w-full h-full pb-28 pt-8 px-5 overflow-y-auto">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-yellow-400/20 to-orange-500/20 border border-yellow-500/30 text-yellow-400 mb-5 shadow-[0_0_30px_rgba(250,204,21,0.15)]">
          <Trophy size={40} />
        </div>
        <h2 className="text-4xl font-black text-white mb-3 tracking-tight">Wall of Fame</h2>
        <p className="text-zinc-400 text-sm">Top players around the world</p>
      </div>

      {activeChallenge && (
        <>
          <div className="flex p-1 bg-white/5 border border-white/10 rounded-2xl mb-6">
            <button
              onClick={() => setPeriod('all_time')}
              className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all ${period === 'all_time' ? 'bg-white text-black shadow-md' : 'text-zinc-400 hover:text-white'}`}
            >
              All Time
            </button>
            <button
              onClick={() => setPeriod('challenge')}
              className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all ${period === 'challenge' ? 'bg-white text-black shadow-md' : 'text-zinc-400 hover:text-white'}`}
            >
              Active Challenge
            </button>
          </div>

          {period === 'challenge' && (
            <div className="mb-6 p-4 rounded-2xl bg-gradient-to-r from-orange-500/20 to-red-500/20 border border-orange-500/30 flex items-center justify-between">
              <div>
                <h3 className="text-white font-bold text-lg">{activeChallenge.title}</h3>
                <p className="text-orange-200 text-sm">Earn coins to climb the ranks!</p>
              </div>
              <div className="text-right">
                <div className="flex items-center gap-1 text-orange-400 mb-1 justify-end">
                  <Timer size={16} />
                  <span className="text-xs font-bold uppercase tracking-wider">Ends In</span>
                </div>
                <div className="text-white font-mono font-bold text-lg tabular-nums">
                  {timeLeft}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl overflow-hidden shadow-xl min-h-[300px] relative">
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="animate-spin text-yellow-500" size={32} />
          </div>
        ) : (
          displayList.map((user, index) => {
            const isCurrentUser = user.id === currentUserId;
            const displayRank = user.rank;
            
            return (
              <div 
                key={user.id}
                className={`flex items-center justify-between p-4 border-b border-white/5 last:border-0 transition-colors ${
                  isCurrentUser ? 'bg-blue-500/10' : 'hover:bg-white/5'
                }`}
              >
                <div className="flex items-center gap-4">
                  <div className={`w-8 text-center font-black text-lg ${
                    displayRank === 1 ? 'text-yellow-400 drop-shadow-[0_0_8px_rgba(250,204,21,0.5)]' : 
                    displayRank === 2 ? 'text-zinc-300 drop-shadow-[0_0_8px_rgba(212,212,216,0.5)]' : 
                    displayRank === 3 ? 'text-amber-600 drop-shadow-[0_0_8px_rgba(217,119,6,0.5)]' : 'text-zinc-600'
                  }`}>
                    {displayRank === 1 ? <Crown size={24} className="mx-auto" /> : 
                     displayRank === 0 ? '...' : `#${displayRank}`}
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold text-white shadow-inner ${
                      isCurrentUser ? 'bg-blue-500' : 'bg-white/10'
                    }`}>
                      {user.name.charAt(0).toUpperCase()}
                    </div>
                    <span className={`font-bold text-base ${isCurrentUser ? 'text-blue-400' : 'text-white'}`}>
                      {user.name}
                    </span>
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-yellow-400 font-bold tabular-nums tracking-wide">
                    {formatCoins(user.coins)}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
