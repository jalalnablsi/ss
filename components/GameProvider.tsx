'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { AdModal } from './AdModal';
import { Loader2, AlertCircle } from 'lucide-react';
import { useTonWallet } from '@tonconnect/ui-react';

// --- Types & Globals ---
declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        initData: string;
        initDataUnsafe: { user?: { id: number; first_name: string; last_name?: string; username?: string }; start_param?: string };
        expand: () => void;
        ready: () => void;
        HapticFeedback?: { notificationOccurred: (type: 'success' | 'warning' | 'error') => void; impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void };
        showPopup: (params: { title?: string; message: string; buttons: { type: 'ok' | 'cancel' | 'default' | 'destructive'; text?: string }[] }) => void;
      };
    };
    Adsgram?: { init: (config: { blockId: string }) => { show: () => Promise<void> } };
  }
}

interface GameState {
  coins: number;
  energy: number;
  maxEnergy: number;
  tapMultiplier: number;
  tapMultiplierEndTime: number;
  autoBotActiveUntil: number;
  adsWatchedToday: number;
  lastAdWatchDate: string;
  lastUpdateTime: number;
  totalTaps: number;
  walletConnected: boolean;
  walletAddress: string | null;
  referralsCount: number;
  referralsActivated: number;
  referralCoinsEarned: number;
}

interface GameContextType extends GameState {
  tap: (amount: number) => boolean;
  watchAdForMultiplier: () => Promise<void>;
  watchAdForEnergy: () => Promise<void>;
  watchAdForBot: () => Promise<void>;
  claimTask: (reward: number, taskId: string) => void;
  completedTasks: string[];
  isWatchingAd: boolean;
  claimReferralReward: () => void;
}

const defaultState: GameState = {
  coins: 0, energy: 500, maxEnergy: 500, tapMultiplier: 1, tapMultiplierEndTime: 0,
  autoBotActiveUntil: 0, adsWatchedToday: 0, lastAdWatchDate: new Date().toISOString().split('T')[0],
  lastUpdateTime: Date.now(), totalTaps: 0, walletConnected: false, walletAddress: null,
  referralsCount: 0, referralsActivated: 0, referralCoinsEarned: 0,
};

const GameContext = createContext<GameContextType | null>(null);

export const useGame = () => {
  const context = useContext(GameContext);
  if (!context) throw new Error('useGame must be used within GameProvider');
  return context;
};

export const GameProvider = ({ children }: { children: React.ReactNode }) => {
  const [state, setState] = useState<GameState>(defaultState);
  const [completedTasks, setCompletedTasks] = useState<string[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isWatchingAd, setIsWatchingAd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wallet = useTonWallet();

  // ✅ تحديث نوع fallbackAd ليتوافق مع AdModal الجديد
  const [fallbackAd, setFallbackAd] = useState<{ 
    isOpen: boolean; 
    type: 'multiplier' | 'energy' | 'bot'; 
    resolve: ((value: boolean) => void) | null 
  }>({
    isOpen: false, 
    type: 'multiplier', 
    resolve: null,
  });

  // --- OPTIMIZED SYNC LOGIC ---
  const pendingTapsCount = useRef<number>(0);
  const isSyncing = useRef<boolean>(false);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // مرجع لتتبع آخر قيمة عملات تم استلامها من السيرفر لتجنب التناقض
  const lastServerCoinsRef = useRef<number>(0);

  // Initialize
  useEffect(() => {
    const initApp = async () => {
      try {
        if (typeof window === 'undefined' || !window.Telegram?.WebApp) {
          setIsLoaded(true); 
          return;
        }

        const webApp = window.Telegram.WebApp;
        webApp.expand();
        webApp.ready();

        const initData = webApp.initData;
        const user = webApp.initDataUnsafe.user;
        const referralCode = webApp.initDataUnsafe.start_param;

        if (!user || !initData) {
          setError('Failed to authenticate.');
          return;
        }

        const response = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initData, referralCode }),
        });

        if (!response.ok) throw new Error('Auth failed');
        const data = await response.json();
        
        const initialState = {
          coins: data.user.coins, energy: data.user.energy, maxEnergy: data.user.max_energy,
          tapMultiplier: data.user.tap_multiplier, tapMultiplierEndTime: data.user.tap_multiplier_end_time,
          autoBotActiveUntil: data.user.auto_bot_active_until, adsWatchedToday: data.user.ads_watched_today,
          lastAdWatchDate: data.user.last_ad_watch_date, lastUpdateTime: data.serverTime,
          totalTaps: data.user.total_taps, walletConnected: data.user.wallet_connected,
          walletAddress: data.user.wallet_address, referralsCount: data.user.referrals_count,
          referralsActivated: data.user.referrals_activated, referralCoinsEarned: data.user.referral_coins_earned,
        };

        setState(initialState);
        lastServerCoinsRef.current = data.user.coins;
        setCompletedTasks(data.user.completed_tasks || []);
        setIsLoaded(true);
      } catch (err) {
        console.error('Init error:', err);
        setError('Connection error.');
      }
    };
    initApp();
  }, []);

  const syncWithServer = useCallback(async (adWatchedType?: string) => {
    if (isSyncing.current && !adWatchedType) return;
    if (pendingTapsCount.current === 0 && !adWatchedType) return;

    isSyncing.current = true;
    const countToSend = pendingTapsCount.current;
    pendingTapsCount.current = 0; 

    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);

    try {
      const initData = window.Telegram?.WebApp?.initData;
      
      // وضع التجربة المحلي (لا سيرفر)
      if (!initData && typeof window !== 'undefined') {
         setState(prev => ({ 
             ...prev, 
             coins: prev.coins + countToSend, 
             energy: Math.max(0, prev.energy - countToSend) 
         }));
         isSyncing.current = false;
         return;
      }

      const response = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          initData,
          taps: countToSend > 0 ? [{ timestamp: Date.now(), value: 1 }] : [], // تبسيط للتصحيح
          adWatchedType,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Sync failed: ${response.status} ${errText}`);
      }

      const data = await response.json();
      
      setState(prev => {
        const newState = {
          ...prev,
          coins: data.user.coins,
          energy: data.user.energy,
          totalTaps: data.user.total_taps,
          tapMultiplier: data.user.tap_multiplier,
          tapMultiplierEndTime: data.user.tap_multiplier_end_time,
          autoBotActiveUntil: data.user.auto_bot_active_until,
          adsWatchedToday: data.user.ads_watched_today,
          lastUpdateTime: data.serverTime,
        };
        lastServerCoinsRef.current = data.user.coins;
        return newState;
      });

    } catch (error) {
      console.error('Sync failed, restoring queue', error);
      pendingTapsCount.current += countToSend;
      setTimeout(() => syncWithServer(adWatchedType), 5000);
    } finally {
      isSyncing.current = false;
    }
  }, []);

  const scheduleSync = useCallback(() => {
    if (syncTimeoutRef.current) return;
    syncTimeoutRef.current = setTimeout(() => syncWithServer(), 800); 
  }, [syncWithServer]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (isLoaded && !isSyncing.current && pendingTapsCount.current === 0) {
        syncWithServer();
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [isLoaded, syncWithServer]);

  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      if (pendingTapsCount.current > 0 && isLoaded) syncWithServer();
    };
  }, [isLoaded, syncWithServer]);

  const tap = useCallback((amount: number) => {
    let success = false;
    setState(prev => {
      if (prev.energy >= 1) {
        success = true;
        const now = Date.now();
        const multiplier = prev.tapMultiplierEndTime > now ? prev.tapMultiplier : 1;
        const totalAmount = amount * multiplier;

        pendingTapsCount.current += 1;
        scheduleSync();

        if (typeof window !== 'undefined' && window.Telegram?.WebApp?.HapticFeedback) {
            window.Telegram.WebApp.HapticFeedback.impactOccurred('soft');
        }

        return {
          ...prev,
          coins: prev.coins + totalAmount,
          energy: prev.energy - 1,
          totalTaps: prev.totalTaps + 1,
        };
      }
      return prev;
    });
    return success;
  }, [scheduleSync]);

  // Ads Logic - محدث ليتوافق مع AdModal الجديد
  const showAd = async (type: 'multiplier' | 'energy' | 'bot'): Promise<boolean> => {
    setIsWatchingAd(true);
    const blockId = process.env.NEXT_PUBLIC_ADSGRAM_BLOCK_ID;
    
    if (!blockId || blockId === "25333") {
      return new Promise<boolean>((resolve) => {
        setFallbackAd({ isOpen: true, type, resolve });
      }).finally(() => setIsWatchingAd(false));
    }

    try {
      if (!window.Adsgram) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = "https://sad.adsgram.ai/js/sad.min.js";
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Failed to load SDK'));
          document.head.appendChild(script);
        });
      }
      if (window.Adsgram) {
        await window.Adsgram.init({ blockId }).show();
        return true;
      }
      return false;
    } catch (e) {
      console.error("Ad error", e);
      return false;
    } finally {
      setIsWatchingAd(false);
    }
  };

  const watchAdForMultiplier = async () => { 
    if (await showAd('multiplier')) {
      setTimeout(() => syncWithServer('multiplier'), 500); 
    }
  };
  
  const watchAdForEnergy = async () => { 
    if (await showAd('energy')) {
      setTimeout(() => syncWithServer('energy'), 500);
    }
  };
  
  const watchAdForBot = async () => { 
    if (await showAd('bot')) {
      setTimeout(() => syncWithServer('bot'), 500);
    }
  };

  const claimTask = useCallback(async (reward: number, taskId: string) => {
    if (completedTasks.includes(taskId)) return;
    try {
      const initData = window.Telegram?.WebApp?.initData;
      if (!initData) return;
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData, taskId }),
      });
      if (res.ok) {
        const data = await res.json();
        setCompletedTasks(data.user.completed_tasks || []);
        setState(prev => ({ ...prev, coins: data.user.coins }));
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to claim task');
      }
    } catch (e) { console.error(e); alert('Network error'); }
  }, [completedTasks]);

  const claimReferralReward = useCallback(() => {
    alert('Referral rewards are automatically added when your friends reach 500 taps!');
  }, []);

  if (error) {
    return (
      <div className="min-h-screen bg-[#050505] flex flex-col items-center justify-center text-white p-6 text-center">
        <AlertCircle className="text-red-500 mb-4" size={64} />
        <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
        <p className="text-zinc-400">{error}</p>
        <button onClick={() => window.location.reload()} className="mt-4 px-4 py-2 bg-yellow-500 rounded-lg text-black font-bold">Retry</button>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center text-white">
        <Loader2 className="animate-spin text-yellow-500" size={48} />
      </div>
    );
  }

  return (
    <GameContext.Provider value={{
      ...state, tap, watchAdForMultiplier, watchAdForEnergy, watchAdForBot,
      claimTask, completedTasks, isWatchingAd, claimReferralReward
    }}>
      {children}
      
      {/* ✅ استخدام AdModal بالطريقة الصحيحة مع type بدلاً من title/description */}
      <AdModal 
        isOpen={fallbackAd.isOpen} 
        type={fallbackAd.type}
        onClose={() => {
          setFallbackAd(prev => ({ ...prev, isOpen: false }));
          if (fallbackAd.resolve) fallbackAd.resolve(false);
        }}
        onWatch={async () => {
          if (fallbackAd.resolve) {
            fallbackAd.resolve(true);
            setFallbackAd(prev => ({ ...prev, isOpen: false }));
          }
        }}
        isWatching={isWatchingAd}
      />
    </GameContext.Provider>
  );
};
