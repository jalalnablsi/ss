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

  // Fallback Ad Modal State
  const [fallbackAd, setFallbackAd] = useState<{ isOpen: boolean; title: string; description: string; resolve: ((value: boolean) => void) | null }>({
    isOpen: false, title: '', description: '', resolve: null,
  });

  // --- OPTIMIZED SYNC LOGIC ---
  const pendingTapsCount = useRef<number>(0);
  const isSyncing = useRef<boolean>(false);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize
  useEffect(() => {
    const initApp = async () => {
      try {
        if (typeof window === 'undefined' || !window.Telegram?.WebApp) {
          // للتجربة على المتصفح فقط
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
        
        setState({
          coins: data.user.coins, energy: data.user.energy, maxEnergy: data.user.max_energy,
          tapMultiplier: data.user.tap_multiplier, tapMultiplierEndTime: data.user.tap_multiplier_end_time,
          autoBotActiveUntil: data.user.auto_bot_active_until, adsWatchedToday: data.user.ads_watched_today,
          lastAdWatchDate: data.user.last_ad_watch_date, lastUpdateTime: data.serverTime,
          totalTaps: data.user.total_taps, walletConnected: data.user.wallet_connected,
          walletAddress: data.user.wallet_address, referralsCount: data.user.referrals_count,
          referralsActivated: data.user.referrals_activated, referralCoinsEarned: data.user.referral_coins_earned,
        });
        setCompletedTasks(data.user.completed_tasks || []);
        setIsLoaded(true);
      } catch (err) {
        console.error('Init error:', err);
        setError('Connection error.');
      }
    };
    initApp();
  }, []);

  // دالة المزامنة المحسنة (ترسل رقماً واحداً فقط)
  const syncWithServer = useCallback(async (adWatchedType?: string) => {
    if (isSyncing.current && !adWatchedType) return;
    if (pendingTapsCount.current === 0 && !adWatchedType) return;

    isSyncing.current = true;
    const countToSend = pendingTapsCount.current;
    pendingTapsCount.current = 0; // تصفير فوري

    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);

    try {
      const initData = window.Telegram?.WebApp?.initData;
      if (!initData && typeof window !== 'undefined') {
         // وضع التجربة المحلي
         setState(prev => ({ ...prev, coins: prev.coins + countToSend, energy: Math.max(0, prev.energy - countToSend) }));
         isSyncing.current = false;
         return;
      }

      const response = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          initData,
          tapCount: countToSend, // 🔥 إرسال رقم واحد فقط
          adWatchedType,
        }),
      });

      if (!response.ok) throw new Error('Sync failed');
      const data = await response.json();
      
      setState(prev => ({
        ...prev,
        coins: data.user.coins,
        energy: data.user.energy,
        totalTaps: data.user.total_taps,
        tapMultiplierEndTime: data.user.tap_multiplier_end_time,
        autoBotActiveUntil: data.user.auto_bot_active_until,
        adsWatchedToday: data.user.ads_watched_today,
        lastUpdateTime: data.serverTime,
      }));

    } catch (error) {
      console.error('Sync failed, restoring queue', error);
      pendingTapsCount.current += countToSend;
      setTimeout(() => syncWithServer(), 5000);
    } finally {
      isSyncing.current = false;
    }
  }, []);

  // جدولة المزامنة
  const scheduleSync = useCallback(() => {
    if (syncTimeoutRef.current) return;
    syncTimeoutRef.current = setTimeout(() => syncWithServer(), 1000); // تجميع كل ثانية
  }, [syncWithServer]);

  // مزامنة دورية للطاقة
  useEffect(() => {
    const interval = setInterval(() => {
      if (isLoaded && !isSyncing.current) syncWithServer();
    }, 5000);
    return () => clearInterval(interval);
  }, [isLoaded, syncWithServer]);

  // تنظيف
  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      if (pendingTapsCount.current > 0 && isLoaded) syncWithServer();
    };
  }, [isLoaded, syncWithServer]);

  // دالة اللمس (Optimistic UI)
  const tap = useCallback((amount: number) => {
    let success = false;
    setState(prev => {
      if (prev.energy >= 1) {
        success = true;
        const now = Date.now();
        const multiplier = prev.tapMultiplierEndTime > now ? prev.tapMultiplier : 1;
        const totalAmount = amount * multiplier;

        // تحديث محلي فوري
        pendingTapsCount.current += 1;
        scheduleSync();

        // اهتزاز خفيف (Haptic Feedback)
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

  // Ads Logic (نفس الكود السابق)
  const showAd = async (title: string, description: string): Promise<boolean> => {
    setIsWatchingAd(true);
    const blockId = process.env.NEXT_PUBLIC_ADSGRAM_BLOCK_ID;
    
    if (!blockId || blockId === 'test-block-id') {
      return new Promise((resolve) => {
        setFallbackAd({ isOpen: true, title, description, resolve });
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

  const watchAdForMultiplier = async () => { if (await showAd('Double Strike', 'x2 for 5 mins')) await syncWithServer('multiplier'); };
  const watchAdForEnergy = async () => { if (await showAd('Full Energy', 'Refill energy')) await syncWithServer('energy'); };
  const watchAdForBot = async () => { if (await showAd('Auto Bot', '6 hours auto tap')) await syncWithServer('bot'); };

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
      }
    } catch (e) { console.error(e); }
  }, [completedTasks]);

  const claimReferralReward = useCallback(() => {
    setState(prev => ({ ...prev, coins: prev.coins + 1500, referralCoinsEarned: prev.referralCoinsEarned + 1500 }));
  }, []);

  if (error) {
    return (
      <div className="min-h-screen bg-[#050505] flex flex-col items-center justify-center text-white p-6 text-center">
        <AlertCircle className="text-red-500 mb-4" size={64} />
        <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
        <p className="text-zinc-400">{error}</p>
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
      <AdModal isOpen={fallbackAd.isOpen} title={fallbackAd.title} description={fallbackAd.description}
        onComplete={(success) => { setFallbackAd(prev => ({ ...prev, isOpen: false })); if (fallbackAd.resolve) fallbackAd.resolve(success); }}
      />
    </GameContext.Provider>
  );
};
