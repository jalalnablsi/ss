'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { AdModal } from './AdModal';
import { Loader2, AlertCircle } from 'lucide-react';
import { useTonWallet } from '@tonconnect/ui-react';

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
  adProtection: {
    remainingToday: number;
    remainingThisHour: number;
    nextAdInSeconds: number;
    isAllowed: boolean;
    waitSeconds: number;
  } | null;
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
  checkAdEligibility: () => Promise<void>;
}

const defaultState: GameState = {
  coins: 0, 
  challengeCoins: 0, 
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
  adsgramBlockId: null,
  adProtection: null,
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

  const [fallbackAd, setFallbackAd] = useState<{ 
    isOpen: boolean; 
    title: string; 
    description: string; 
    resolve: ((value: boolean) => void) | null; 
  }>({ 
    isOpen: false, 
    title: '', 
    description: '', 
    resolve: null 
  });

  const tapQueue = useRef<{ t: number; a: number }[]>([]);
  const isSyncing = useRef(false);
  const lastTapTimeRef = useRef<number>(0);
  
  // ✅ إصلاح: Refs لإدارة حالة الإعلانات بشكل منفصل
  const adProtectionCache = useRef<{
    data: any;
    timestamp: number;
  } | null>(null);
  const AD_PROTECTION_CACHE_MS = 5000; // Cache لمدة 5 ثوانٍ

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
      adProtection: data.meta?.adProtection || null,
    }));
    setCompletedTasks(data.user.completedTasks || []);
    setIsLoaded(true);
  }, []);

  // ✅ إصلاح: Caching لحماية الإعلانات + Debounce
  const checkAdEligibility = useCallback(async (force: boolean = false) => {
    if (!isLoaded) return;
    
    // ✅ استخدام Cache إذا كان متاحاً ولم تنتهِ صلاحيته
    if (!force && adProtectionCache.current) {
      const age = Date.now() - adProtectionCache.current.timestamp;
      if (age < AD_PROTECTION_CACHE_MS) {
        setState(prev => ({
          ...prev,
          adProtection: adProtectionCache.current!.data
        }));
        return;
      }
    }
    
    try {
      const initData = window.Telegram?.WebApp?.initData;
      if (!initData) return;

      const response = await fetch('/api/ad-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData }),
      });
      
      if (response.ok) {
        const data = await response.json();
        const protectionData = {
          remainingToday: data.remainingToday,
          remainingThisHour: data.remainingThisHour,
          nextAdInSeconds: data.nextAdInSeconds || 0,
          isAllowed: data.isAllowed,
          waitSeconds: data.waitSeconds || 0
        };
        
        // ✅ تحديث Cache
        adProtectionCache.current = {
          data: protectionData,
          timestamp: Date.now()
        };
        
        setState(prev => ({
          ...prev,
          adProtection: protectionData
        }));
      }
    } catch (e) {
      console.error("Ad eligibility check failed", e);
    }
  }, [isLoaded]);

  useEffect(() => {
    const initApp = async () => {
      try {
        if (typeof window === 'undefined' || !window.Telegram?.WebApp) {
          setError('This app must be opened from Telegram');
          return;
        }

        const webApp = window.Telegram.WebApp;
        webApp.expand();
        webApp.ready();

        const initData = webApp.initData;
        const user = webApp.initDataUnsafe.user;
        const referralCode = webApp.initDataUnsafe.start_param;

        if (!user) {
          setError('No user data available');
          return;
        }

        const response = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initData, referralCode }),
        });
        
        if (!response.ok) {
          throw new Error('Authentication failed');
        }
        
        const data = await response.json();
        updateStateFromServer(data);

      } catch (err) {
        console.error('Init error:', err);
        setError('Failed to initialize app');
      }
    };

    initApp();
  }, [updateStateFromServer]);

  // ✅ إصلاح: Sync أقل تكراراً (كل 10 ثوانٍ بدلاً من 5)
  useEffect(() => {
    if (!isLoaded) return;
    
    checkAdEligibility();
    
    // ✅ تقليل تكرار الفحص إلى كل 30 ثانية
    const interval = setInterval(() => {
      checkAdEligibility();
    }, 30000);
    
    return () => clearInterval(interval);
  }, [isLoaded, checkAdEligibility]);

  // ✅ إصلاح: Batching أفضل للـ Taps
  const syncWithServer = useCallback(async (adWatchedType?: string) => {
    if (!isLoaded || (tapQueue.current.length === 0 && !adWatchedType) || isSyncing.current) return;
    isSyncing.current = true;

    const tapsToSync = [...tapQueue.current];
    tapQueue.current = [];

    try {
      const initData = window.Telegram?.WebApp?.initData;
      if (!initData) throw new Error('No initData');

      const payload = {
        initData,
        taps: tapsToSync,
        adWatchedType,
      };

      const response = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        if (errorData.code === 'COOLDOWN_ACTIVE' || 
            errorData.code === 'HOURLY_LIMIT_REACHED' || 
            errorData.code === 'DAILY_LIMIT_REACHED' ||
            errorData.code === 'SUSPICIOUS_ACTIVITY') {
          
          const protectionData = {
            remainingToday: errorData.details?.remainingToday || 0,
            remainingThisHour: errorData.details?.remainingThisHour || 0,
            nextAdInSeconds: errorData.details?.waitSeconds || 0,
            isAllowed: false,
            waitSeconds: errorData.details?.waitSeconds || 0
          };
          
          // ✅ تحديث Cache
          adProtectionCache.current = {
            data: protectionData,
            timestamp: Date.now()
          };
          
          setState(prev => ({
            ...prev,
            adProtection: protectionData
          }));
          throw new Error(errorData.error);
        }
        throw new Error('Sync failed');
      }

      const data = await response.json();
      
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
        adProtection: data.meta?.adProtection || null,
        lastUpdateTime: Date.now(),
      }));

    } catch (error) {
      console.error('Sync failed, restoring queue', error);
      // ✅ إعادة أقل عدد من الـ Taps لتجنب الازدحام
      if (tapsToSync.length <= 50) {
        tapQueue.current = [...tapsToSync, ...tapQueue.current];
      }
    } finally {
      isSyncing.current = false;
    }
  }, [isLoaded]);

  // ✅ إصلاح: Sync كل 10 ثوانٍ بدلاً من 5
  useEffect(() => {
    const interval = setInterval(() => syncWithServer(), 10000);
    return () => clearInterval(interval);
  }, [syncWithServer]);

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

  // ✅ إصلاح: Debounce للـ Tap
  const tap = useCallback((amount: number) => {
    const now = Date.now();
    
    // ✅ منع الضغط السريع جداً
    if (now - lastTapTimeRef.current < 50) {
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
        const blockId = state.adsgramBlockId || process.env.NEXT_PUBLIC_ADSGRAM_BLOCK_ID;
        if (!blockId) {
          console.error('No Adsgram block ID configured');
          return false;
        }
        
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

  // ✅ إصلاح: التحقق من صلاحية الإعلان مع Cache
  const validateAdEligibility = async (): Promise<boolean> => {
    // ✅ استخدام Cache أولاً
    if (adProtectionCache.current) {
      const age = Date.now() - adProtectionCache.current.timestamp;
      const protection = adProtectionCache.current.data;
      
      if (age < AD_PROTECTION_CACHE_MS && protection.isAllowed && protection.nextAdInSeconds === 0) {
        return true;
      }
    }
    
    // ✅ إذا لم يكن Cache صالحاً، تحقق من السيرفر
    await checkAdEligibility(true);
    
    const protection = adProtectionCache.current?.data;
    if (!protection) return false;
    
    if (!protection.isAllowed || protection.nextAdInSeconds > 0) {
      return false;
    }
    
    return true;
  };

  const watchAdForMultiplier = async () => {
    const isEligible = await validateAdEligibility();
    if (!isEligible) {
      console.warn('Ad not eligible:', adProtectionCache.current?.data);
      return;
    }

    if (state.tapMultiplierEndTime > Date.now()) return;

    const success = await showAd('Quad Strike (x4)', 'Watch ad to get 4x tap multiplier for 5 minutes + 1000 instant coins!');
    if (success) {
      const now = Date.now();
      const newEndTime = now + 5 * 60 * 1000;
      
      setState(prev => ({
        ...prev,
        tapMultiplier: 4,
        tapMultiplierEndTime: newEndTime,
        coins: prev.coins + 1000,
        challengeCoins: prev.challengeCoins + 1000,
        lastUpdateTime: now
      }));
      
      await syncWithServer('multiplier');
      // ✅ تحديث Cache بعد المشاهدة
      await checkAdEligibility(true);
    }
  };

  const watchAdForEnergy = async () => {
    const isEligible = await validateAdEligibility();
    if (!isEligible) {
      console.warn('Ad not eligible:', adProtectionCache.current?.data);
      return;
    }

    if (state.energy >= state.maxEnergy) return;
    
    const success = await showAd('Full Energy Refill', 'Watch ad to restore full energy instantly + 1000 instant coins!');
    if (success) {
      const now = Date.now();
      
      setState(prev => ({
        ...prev,
        energy: prev.maxEnergy,
        coins: prev.coins + 1000,
        challengeCoins: prev.challengeCoins + 1000,
        lastUpdateTime: now
      }));
      
      await syncWithServer('energy');
      await checkAdEligibility(true);
    }
  };

  const watchAdForBot = async () => {
    const isEligible = await validateAdEligibility();
    if (!isEligible) {
      console.warn('Ad not eligible:', adProtectionCache.current?.data);
      return;
    }

    const success = await showAd('Auto-Tap Bot', 'Watch ad to activate auto-tap bot for 6 hours + 1000 instant coins!');
    if (success) {
      const now = Date.now();
      const newEndTime = Math.max(now, state.autoBotActiveUntil) + 6 * 60 * 60 * 1000;
      
      setState(prev => ({
        ...prev,
        autoBotActiveUntil: newEndTime,
        coins: prev.coins + 1000,
        challengeCoins: prev.challengeCoins + 1000,
        lastUpdateTime: now
      }));
      
      await syncWithServer('bot');
      await checkAdEligibility(true);
    }
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
        setState(prev => ({ 
          ...prev, 
          coins: data.user.coins, 
          challengeCoins: data.user.challenge_coins || 0 
        }));
      }
    } catch (e) { 
      console.error(e); 
    }
  }, [completedTasks]);

  const claimReferralReward = useCallback(() => {
    setState(prev => ({
      ...prev, 
      coins: prev.coins + 1500, 
      challengeCoins: prev.challengeCoins + 1500,
      referralCoinsEarned: prev.referralCoinsEarned + 1500,
    }));
  }, []);

  const refreshUserData = async () => {
    if (!isLoaded) return;
    
    const initData = window.Telegram?.WebApp?.initData;
    const referralCode = window.Telegram?.WebApp?.initDataUnsafe.start_param;
    
    if (!initData) return;
    
    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData, referralCode }),
      });
      
      if (response.ok) {
        const data = await response.json();
        updateStateFromServer(data);
      }
    } catch (e) { 
      console.error("Refresh failed", e); 
    }
  };

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
      claimReferralReward, 
      refreshUserData,
      checkAdEligibility
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
