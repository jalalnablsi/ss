'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { AdModal } from './AdModal';
import { Loader2, AlertCircle } from 'lucide-react';
import { useTonWallet } from '@tonconnect/ui-react';

// Telegram WebApp global type definition
declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        initData: string;
        initDataUnsafe: {
          user?: {
            id: number;
            first_name: string;
            last_name?: string;
            username?: string;
          };
          start_param?: string;
        };
        expand: () => void;
        ready: () => void;
      };
    };
    Adsgram?: {
      init: (config: { blockId: string }) => {
        show: () => Promise<void>;
      };
    };
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
  coins: 0,
  energy: 500,
  maxEnergy: 500,
  tapMultiplier: 1,
  tapMultiplierEndTime: 0,
  autoBotActiveUntil: 0,
  adsWatchedToday: 0,
  lastAdWatchDate: new Date().toISOString().split('T')[0],
  lastUpdateTime: Date.now(),
  totalTaps: 0,
  walletConnected: false,
  walletAddress: null,
  referralsCount: 0,
  referralsActivated: 0,
  referralCoinsEarned: 0,
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
  const [fallbackAd, setFallbackAd] = useState<{
    isOpen: boolean;
    title: string;
    description: string;
    resolve: ((value: boolean) => void) | null;
  }>({
    isOpen: false,
    title: '',
    description: '',
    resolve: null,
  });

  // --- IMPROVED SYNC QUEUE & ANTI-CHEAT ---
  // نخزن فقط عدد اللمسات غير المرسلة، لا نحتاج لتخزين الوقت لكل لمسة محلياً
  const pendingTapsCount = useRef<number>(0);
  const isSyncing = useRef<boolean>(false);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastServerTimeRef = useRef<number>(0);

  // Initialize Telegram WebApp and Authenticate
  useEffect(() => {
    const initApp = async () => {
      try {
        if (typeof window === 'undefined' || !window.Telegram?.WebApp) {
          setError('Please open this app inside Telegram.');
          return;
        }

        const webApp = window.Telegram.WebApp;
        webApp.expand();
        webApp.ready();

        const initData = webApp.initData;
        const user = webApp.initDataUnsafe.user;
        const referralCode = webApp.initDataUnsafe.start_param;

        if (!user || !initData) {
          setError('Failed to authenticate with Telegram. Please restart the app.');
          return;
        }

        const response = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initData, referralCode }),
        });

        if (!response.ok) {
          const errData = await response.json();
          setError(errData.error || 'Failed to connect to server.');
          return;
        }

        const data = await response.json();
        
        setState({
          coins: data.user.coins,
          energy: data.user.energy,
          maxEnergy: data.user.max_energy,
          tapMultiplier: data.user.tap_multiplier,
          tapMultiplierEndTime: data.user.tap_multiplier_end_time,
          autoBotActiveUntil: data.user.auto_bot_active_until,
          adsWatchedToday: data.user.ads_watched_today,
          lastAdWatchDate: data.user.last_ad_watch_date,
          lastUpdateTime: data.serverTime, // مهم جداً: نحتفظ بوقت السيرفر
          totalTaps: data.user.total_taps,
          walletConnected: data.user.wallet_connected,
          walletAddress: data.user.wallet_address,
          referralsCount: data.user.referrals_count,
          referralsActivated: data.user.referrals_activated,
          referralCoinsEarned: data.user.referral_coins_earned,
        });
        
        setCompletedTasks(data.user.completed_tasks || []);
        lastServerTimeRef.current = data.serverTime;
        setIsLoaded(true);
      } catch (err) {
        console.error('Init error:', err);
        setError('An unexpected error occurred during initialization.');
      }
    };

    initApp();
  }, []);

  // --- OPTIMIZED SYNC FUNCTION ---
  const syncWithServer = useCallback(async (adWatchedType?: string) => {
    // إذا كان هناك مزامنة جارية، لا تبدأ أخرى إلا إذا كان هناك إعلان (الأولوية للإعلان)
    if (isSyncing.current && !adWatchedType) return;
    
    // إذا لم يكن هناك شيء للمزامنة
    if (pendingTapsCount.current === 0 && !adWatchedType) return;

    isSyncing.current = true;
    const tapsToSend = pendingTapsCount.current;
    
    // تصفير العداد المحلي مؤقتاً (Optimistic Reset)
    // إذا فشل الطلب، سنعيده لاحقاً
    pendingTapsCount.current = 0; 

    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = null;
    }

    try {
      const initData = window.Telegram?.WebApp?.initData;
      if (!initData) throw new Error('No initData');

      // نرسل عدد اللمسات فقط، السيرفر سيحسب الرياضيات
      const response = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          initData,
          taps: Array(tapsToSend).fill({ t: Date.now() }), // مصفوفة وهمية للعدد
          adWatchedType,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(err || 'Sync failed');
      }

      const data = await response.json();
      
      // تحديث الحالة ببيانات السيرفر (Source of Truth)
      setState(prev => ({
        ...prev,
        coins: data.user.coins,
        energy: data.user.energy,
        totalTaps: data.user.total_taps,
        tapMultiplier: data.user.tap_multiplier,
        tapMultiplierEndTime: data.user.tap_multiplier_end_time,
        autoBotActiveUntil: data.user.auto_bot_active_until,
        adsWatchedToday: data.user.ads_watched_today,
        lastUpdateTime: data.serverTime,
      }));
      lastServerTimeRef.current = data.serverTime;

    } catch (error) {
      console.error('Sync failed, restoring queue', error);
      // في حالة الفشل، نعيد اللمسات للطابور لمحاولة لاحقة
      pendingTapsCount.current += tapsToSend;
      // إعادة جدولة المحاولة بعد وقت أطول
      syncTimeoutRef.current = setTimeout(() => syncWithServer(), 5000);
    } finally {
      isSyncing.current = false;
    }
  }, []);

  // جدولة المزامنة التلقائية (Debounce)
  const scheduleSync = useCallback(() => {
    if (syncTimeoutRef.current) return;
    
    syncTimeoutRef.current = setTimeout(() => {
      syncWithServer();
    }, 1000); // انتظار ثانية واحدة بعد آخر لمسة قبل الإرسال
  }, [syncWithServer]);

  // مزامنة دورية كل 5 ثوانٍ للحفاظ على تحديث الطاقة (حتى بدون لمس)
  useEffect(() => {
    const interval = setInterval(() => {
      if (isLoaded && !isSyncing.current) {
        syncWithServer();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [isLoaded, syncWithServer]);

  // تنظيف عند الخروج
  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      if (pendingTapsCount.current > 0 && isLoaded) {
        // محاولة أخيرة للإرسال
        syncWithServer(); 
      }
    };
  }, [isLoaded, syncWithServer]);

  // --- TAP LOGIC (OPTIMISTIC ONLY) ---
  const tap = useCallback((amount: number) => {
    let success = false;
    
    setState(prev => {
      // التحقق من الطاقة بناءً على الحالة المحلية الحالية
      // ملاحظة: هذا تحقق بصري فقط، السيرفر هو من يقرر القبول النهائي
      if (prev.energy >= 1) {
        success = true;
        const now = Date.now();
        const multiplier = prev.tapMultiplierEndTime > now ? prev.tapMultiplier : 1;
        const totalAmount = amount * multiplier;

        // 1. تحديث بصري فوري (Optimistic UI)
        // نخصم الطاقة ونزيد العملات محلياً ليعطي شعوراً بالسرعة
        // لا نقوم بتحديث lastUpdateTime هنا لتجنب التعارض مع حسابات السيرفر
        
        // 2. إضافة للطابور
        pendingTapsCount.current += 1;

        // 3. جدولة الإرسال
        scheduleSync();

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

  // --- ADS LOGIC ---
  const showAd = async (title: string, description: string): Promise<boolean> => {
    setIsWatchingAd(true);
    try {
      if (window.Adsgram) {
        const blockId = process.env.NEXT_PUBLIC_ADSGRAM_BLOCK_ID || '25333';
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
          setFallbackAd({
            isOpen: true,
            title,
            description,
            resolve,
          });
        });
      }
    } finally {
      setIsWatchingAd(false);
    }
  };

  const watchAdForMultiplier = async () => {
    const success = await showAd('Double Strike (x2)', 'Watch this ad to get x2 multiplier for 5 minutes.');
    if (success) await syncWithServer('multiplier');
  };

  const watchAdForEnergy = async () => {
    const success = await showAd('Full Energy Refill', 'Watch this ad to instantly restore your energy.');
    if (success) await syncWithServer('energy');
  };

  const watchAdForBot = async () => {
    const success = await showAd('Auto-Tap Bot', 'Watch this ad to activate or progress the Auto-Bot.');
    if (success) await syncWithServer('bot');
  };

  const claimTask = useCallback(async (reward: number, taskId: string) => {
    if (completedTasks.includes(taskId)) return;
    
    try {
      const initData = window.Telegram?.WebApp?.initData;
      if (!initData) return;

      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData, taskId }),
      });

      if (response.ok) {
        const data = await response.json();
        setCompletedTasks(data.user.completed_tasks || []);
        setState(prev => ({ ...prev, coins: data.user.coins }));
      }
    } catch (e) {
      console.error('Task claim error:', e);
    }
  }, [completedTasks]);

  const claimReferralReward = useCallback(() => {
    setState(prev => ({
      ...prev,
      coins: prev.coins + 1500,
      referralCoinsEarned: prev.referralCoinsEarned + 1500,
    }));
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
      ...state,
      tap,
      watchAdForMultiplier,
      watchAdForEnergy,
      watchAdForBot,
      claimTask,
      completedTasks,
      isWatchingAd,
      claimReferralReward
    }}>
      {children}
      <AdModal
        isOpen={fallbackAd.isOpen}
        title={fallbackAd.title}
        description={fallbackAd.description}
        onComplete={(success) => {
          setFallbackAd(prev => ({ ...prev, isOpen: false }));
          if (fallbackAd.resolve) fallbackAd.resolve(success);
        }}
      />
    </GameContext.Provider>
  );
};
