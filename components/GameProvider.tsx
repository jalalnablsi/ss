'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { AdModal } from './AdModal';
import { Loader2, AlertCircle } from 'lucide-react';
import { useTonWallet } from '@tonconnect/ui-react';

// --- Types ---
declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        initData: string;
        initDataUnsafe: {
          user?: { id: number; first_name: string; last_name?: string; username?: string; };
          start_param?: string;
        };
        expand: () => void;
        ready: () => void;
      };
    };
    Adsgram?: {
      init: (config: { blockId: string }) => { show: () => Promise<void>; };
    };
  }
}

interface GameState {
  coins: number;
  challengeCoins: number;
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
  adsgramBlockId: string | null;
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
  refreshUserData: () => Promise<void>;
}

const defaultState: GameState = {
  coins: 0, challengeCoins: 0, energy: 500, maxEnergy: 500,
  tapMultiplier: 1, tapMultiplierEndTime: 0, autoBotActiveUntil: 0,
  adsWatchedToday: 0, lastAdWatchDate: new Date().toISOString().split('T')[0],
  lastUpdateTime: Date.now(), totalTaps: 0, walletConnected: false,
  walletAddress: null, referralsCount: 0, referralsActivated: 0,
  referralCoinsEarned: 0, adsgramBlockId: null,
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

  const [fallbackAd, setFallbackAd] = useState<{ isOpen: boolean; title: string; description: string; resolve: ((value: boolean) => void) | null; }>({ isOpen: false, title: '', description: '', resolve: null });

  const tapQueue = useRef<{ t: number; a: number }[]>([]);
  const isSyncing = useRef(false);
  const lastTapTimeRef = useRef<number>(0);

  // ✅ دالة محدثة خارج useEffect لتكون متاحة للجميع
  const updateStateFromServer = useCallback((data: any) => {
    setState(prev => ({
      ...prev,
      coins: data.user.coins,
      challengeCoins: data.user.challengeCoins || 0,
      energy: data.user.energy,
      maxEnergy: data.user.maxEnergy,
      tapMultiplier: data.user.tapMultiplier || 1,
      tapMultiplierEndTime: data.user.tapMultiplierEndTime || 0,
      autoBotActiveUntil: data.user.autoBotActiveUntil || 0,
      adsWatchedToday: data.user.adsWatchedToday || 0,
      lastAdWatchDate: data.user.lastAdWatchDate || new Date().toISOString().split('T')[0],
      lastUpdateTime: Date.now(),
      totalTaps: data.user.totalTaps || 0,
      walletConnected: data.user.walletConnected || false,
      walletAddress: data.user.walletAddress || null,
      referralsCount: data.user.referralsCount || 0,
      referralsActivated: data.user.referralsActivated || 0,
      referralCoinsEarned: data.user.referralCoinsEarned || 0,
      adsgramBlockId: data.settings?.adsgramBlockId || null,
    }));
    setCompletedTasks(data.user.completedTasks || []);
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    const initApp = async () => {
      try {
        if (typeof window === 'undefined' || !window.Telegram?.WebApp) {
          const mockInitData = "user=%7B%22id%22%3A123456%2C%22first_name%22%3A%22Test%22%7D&hash=mock";
        }

        const webApp = window.Telegram?.WebApp;
        if(webApp) {
            webApp.expand();
            webApp.ready();
        }

        const initData = webApp?.initData || ""; 
        const user = webApp?.initDataUnsafe.user;
        const referralCode = webApp?.initDataUnsafe.start_param;

        const telegramId = user?.id.toString() || "123456";

        if (!user && !process.env.NEXT_PUBLIC_DEV_MODE) {
        }

        if (webApp && initData) {
             const response = await fetch('/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ initData, referralCode }),
            });
            
            if (response.ok) {
                const data = await response.json();
                updateStateFromServer(data);
            } else {
            }
        } else {
            setIsLoaded(true);
        }

      } catch (err) {
        console.error('Init error:', err);
        setError('An unexpected error occurred.');
      }
    };

    initApp();
  }, [updateStateFromServer]);

  const syncWithSupabase = useCallback(async (adWatchedType?: string) => {
    if (!isLoaded || (tapQueue.current.length === 0 && !adWatchedType) || isSyncing.current) return;
    isSyncing.current = true;

    const tapsToSync = [...tapQueue.current];
    tapQueue.current = [];

    try {
      const initData = window.Telegram?.WebApp?.initData;
      if (!initData && !process.env.NEXT_PUBLIC_DEV_MODE) throw new Error('No initData');

      const payload = {
          initData: initData || "mock_data",
          taps: tapsToSync,
          adWatchedType,
      };

      const response = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error('Sync failed');

      const data = await response.json();
      
      // ✅ تحديث كامل للـ state من السيرفر
      setState(prev => ({
        ...prev,
        coins: data.user.coins,
        challengeCoins: data.user.challengeCoins || 0,
        energy: data.user.energy,
        totalTaps: data.user.totalTaps,
        tapMultiplier: data.user.tapMultiplier,
        tapMultiplierEndTime: data.user.tapMultiplierEndTime,
        autoBotActiveUntil: data.user.autoBotActiveUntil,
        adsWatchedToday: data.user.adsWatchedToday,
        lastUpdateTime: Date.now(),
      }));

    } catch (error) {
      console.error('Sync failed, restoring queue', error);
      tapQueue.current = [...tapsToSync, ...tapQueue.current];
    } finally {
      isSyncing.current = false;
    }
  }, [isLoaded]);

  useEffect(() => {
    const interval = setInterval(() => syncWithSupabase(), 5000);
    return () => clearInterval(interval);
  }, [syncWithSupabase]);

  useEffect(() => {
    if (!isLoaded) return;
    const interval = setInterval(() => {
      setState(prev => {
        const now = Date.now();
        let newEnergy = prev.energy;
        let newCoins = prev.coins;
        let newChallengeCoins = prev.challengeCoins;
        
        const timePassedSec = Math.max(0, (now - prev.lastUpdateTime) / 1000);
        
        if (prev.energy < prev.maxEnergy) {
            const regenRate = prev.maxEnergy / 1800;
            newEnergy = Math.min(prev.maxEnergy, prev.energy + (timePassedSec * regenRate));
        }

        if (prev.autoBotActiveUntil > now) {
          const botEarnings = timePassedSec * 0.5;
          newCoins += botEarnings;
          newChallengeCoins += botEarnings;
        }

        let newMultiplier = prev.tapMultiplier;
        if (prev.tapMultiplierEndTime > 0 && prev.tapMultiplierEndTime <= now) {
          newMultiplier = 1;
        }

        if (newEnergy !== prev.energy || newCoins !== prev.coins || newMultiplier !== prev.tapMultiplier) {
            return {
                ...prev,
                coins: newCoins,
                challengeCoins: newChallengeCoins,
                energy: newEnergy,
                tapMultiplier: newMultiplier,
                lastUpdateTime: now,
            };
        }
        return prev;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isLoaded]);

  // ✅ إصلاح مشكلة النقرة المزدوجة - زيادة الفترة إلى 100ms
  const tap = useCallback((amount: number) => {
    const now = Date.now();
    // زيادة الفترة إلى 100 ملي ثانية للتأكد من عدم تسجيل النقرة المزدوجة
    if (now - lastTapTimeRef.current < 100) {
      return false; 
    }
    
    let success = false;
    
    setState(prev => {
      if (prev.energy >= 1) {
        success = true;
        lastTapTimeRef.current = now;
        
        const isMultiplierActive = prev.tapMultiplierEndTime > now;
        const multiplier = isMultiplierActive ? prev.tapMultiplier : 1;
        const totalAmount = amount * multiplier;
        
        tapQueue.current.push({ t: now, a: totalAmount });

        return {
          ...prev,
          coins: prev.coins + totalAmount,
          challengeCoins: prev.challengeCoins + totalAmount,
          energy: prev.energy - 1,
          totalTaps: prev.totalTaps + 1,
        };
      }
      return prev;
    });
    
    return success;
  }, []);

  const showAd = async (title: string, description: string): Promise<boolean> => {
    setIsWatchingAd(true);
    try {
      if (window.Adsgram) {
        const blockId = state.adsgramBlockId || process.env.NEXT_PUBLIC_ADSGRAM_BLOCK_ID || 'test-block-id';
        const AdController = window.Adsgram.init({ blockId });
        try {
          await AdController.show();
          return true;
        } catch (e) {
          console.error("Adsgram error or user skipped", e);
          return false;
        }
      } else {
        return new Promise((resolve) => {
          setFallbackAd({ isOpen: true, title, description, resolve });
        });
      }
    } finally {
      setIsWatchingAd(false);
    }
  };

  // ✅ إصلاح: تحديث فوري للـ state بعد مشاهدة الإعلان
  const watchAdForMultiplier = async () => {
    // التحقق من عدم وجود مضاعف نشط بالفعل
    if (state.tapMultiplierEndTime > Date.now()) return;

    const success = await showAd('Quad Strike (x4)', 'شاهد الإعلان للحصول على ضرب 4 للنقر لمدة 5 دقائق + 1000 عملة فورية!');
    if (success) {
      const now = Date.now();
      const newEndTime = now + 5 * 60 * 1000;
      
      // ✅ تحديث فوري للـ state قبل المزامنة
      setState(prev => ({
        ...prev,
        tapMultiplier: 4,
        tapMultiplierEndTime: newEndTime,
        coins: prev.coins + 1000,
        challengeCoins: prev.challengeCoins + 1000,
        lastUpdateTime: now
      }));
      
      // ✅ مزامنة مع الخادم
      await syncWithSupabase('multiplier');
    }
  };

  const watchAdForEnergy = async () => {
    if (state.energy >= state.maxEnergy) return;
    const success = await showAd('Full Energy Refill', 'شاهد الإعلان لاستعادة الطاقة كاملة + 1000 عملة فورية!');
    if (success) {
      setState(prev => ({
        ...prev,
        energy: prev.maxEnergy,
        coins: prev.coins + 1000,
        challengeCoins: prev.challengeCoins + 1000,
        lastUpdateTime: Date.now()
      }));
      await syncWithSupabase('energy');
    }
  };

  const watchAdForBot = async () => {
    const success = await showAd('Auto-Tap Bot', 'شاهد الإعلان لتفعيل البوت لمدة 6 ساعات + 1000 عملة فورية!');
    if (success) {
      const now = Date.now();
      setState(prev => ({
        ...prev,
        autoBotActiveUntil: now + 6 * 60 * 60 * 1000,
        coins: prev.coins + 1000,
        challengeCoins: prev.challengeCoins + 1000,
        lastUpdateTime: now
      }));
      await syncWithSupabase('bot');
    }
  };

  const claimTask = useCallback(async (reward: number, taskId: string) => {
    if (completedTasks.includes(taskId)) return;
    try {
      const initData = window.Telegram?.WebApp?.initData || "mock";
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData, taskId }),
      });
      if (response.ok) {
        const data = await response.json();
        setCompletedTasks(data.user.completed_tasks || []);
        setState(prev => ({ ...prev, coins: data.user.coins, challengeCoins: data.user.challenge_coins || 0 }));
      }
    } catch (e) { console.error(e); }
  }, [completedTasks]);

  const claimReferralReward = useCallback(() => {
    setState(prev => ({
      ...prev, coins: prev.coins + 1500, challengeCoins: prev.challengeCoins + 1500,
      referralCoinsEarned: prev.referralCoinsEarned + 1500,
    }));
  }, []);

  // ✅ دالة لإعادة جلب البيانات من السيرفر
  const refreshUserData = async () => {
      if(!isLoaded) return;
      const initData = window.Telegram?.WebApp?.initData || "mock";
      const referralCode = window.Telegram?.WebApp?.initDataUnsafe.start_param;
      
      try {
        const response = await fetch('/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ initData, referralCode }),
        });
        if(response.ok) {
            const data = await response.json();
            updateStateFromServer(data);
        }
      } catch(e) { console.error("Refresh failed", e); }
  };

  if (error && !process.env.NEXT_PUBLIC_DEV_MODE) {
    return (
      <div className="min-h-screen bg-[#050505] flex flex-col items-center justify-center text-white p-6 text-center">
        <AlertCircle className="text-red-500 mb-4" size={64} />
        <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
        <p className="text-zinc-400">{error}</p>
      </div>
    );
  }

  if (!isLoaded && !process.env.NEXT_PUBLIC_DEV_MODE) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center text-white">
        <Loader2 className="animate-spin text-yellow-500" size={48} />
      </div>
    );
  }

  return (
    <GameContext.Provider value={{
      ...state, tap, watchAdForMultiplier, watchAdForEnergy, watchAdForBot,
      claimTask, completedTasks, isWatchingAd, claimReferralReward, refreshUserData
    }}>
      {children}
      <AdModal isOpen={fallbackAd.isOpen} title={fallbackAd.title} description={fallbackAd.description} onComplete={(success) => {
        setFallbackAd(prev => ({ ...prev, isOpen: false }));
        if (fallbackAd.resolve) fallbackAd.resolve(success);
      }} />
    </GameContext.Provider>
  );
};
