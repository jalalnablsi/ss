'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { AdModal } from './AdModal';
import { Loader2, AlertCircle } from 'lucide-react';
import { useTonWallet } from '@tonconnect/ui-react';

// Types
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
    resolve: null,
  });

  // Anti-cheat & Sync Queue
  const tapQueue = useRef<{ t: number; a: number }[]>([]);
  const isSyncing = useRef(false);
  
  // FIX 1: Strict Tap Debounce Ref
  const lastTapTimeRef = useRef<number>(0);

  // Initialize Telegram & Auth
  useEffect(() => {
    const initApp = async () => {
      try {
        // Security Check: Must run inside Telegram WebApp in production
        if (typeof window === 'undefined' || !window.Telegram?.WebApp) {
          setError('Access denied. Please open this app directly inside Telegram.');
          return;
        }

        const webApp = window.Telegram.WebApp;
        webApp.expand();
        webApp.ready();

        const initData = webApp.initData;
        const user = webApp.initDataUnsafe.user;
        const referralCode = webApp.initDataUnsafe.start_param;

        if (!user || !initData) {
          setError('Authentication failed. Invalid Telegram data.');
          return;
        }

        // Authenticate with Backend
        const response = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initData, referralCode }),
        });

        if (!response.ok) {
          const errData = await response.json();
          setError(errData.error || 'Server connection failed.');
          return;
        }

        const data = await response.json();
        
        // Update State from Server
        setState({
          coins: data.user.coins,
          challengeCoins: data.user.challengeCoins || 0,
          energy: data.user.energy,
          maxEnergy: data.user.maxEnergy,
          tapMultiplier: data.user.tapMultiplier,
          tapMultiplierEndTime: data.user.tapMultiplierEndTime,
          autoBotActiveUntil: data.user.autoBotActiveUntil,
          adsWatchedToday: data.user.adsWatchedToday,
          lastAdWatchDate: data.user.lastAdWatchDate,
          lastUpdateTime: Date.now(),
          totalTaps: data.user.totalTaps,
          walletConnected: data.user.walletConnected,
          walletAddress: data.user.walletAddress,
          referralsCount: data.user.referralsCount,
          referralsActivated: data.user.referralsActivated,
          referralCoinsEarned: data.user.referralCoinsEarned,
          adsgramBlockId: data.settings?.adsgramBlockId || null,
        });
        
        setCompletedTasks(data.user.completedTasks || []);
        setIsLoaded(true);

      } catch (err) {
        console.error('Init error:', err);
        setError('System error. Please restart Telegram.');
      }
    };

    initApp();
  }, []);

  const syncWithServer = useCallback(async (adWatchedType?: string) => {
    if (!isLoaded || (tapQueue.current.length === 0 && !adWatchedType) || isSyncing.current) return;
    isSyncing.current = true;

    const tapsToSync = [...tapQueue.current];
    tapQueue.current = [];

    try {
      const initData = window.Telegram?.WebApp?.initData;
      if (!initData) throw new Error('No initData available');

      const response = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          initData,
          taps: tapsToSync,
          adWatchedType,
        }),
      });

      if (!response.ok) throw new Error('Sync failed');

      const data = await response.json();
      
      // Update state with server truth to prevent drift
      setState(prev => ({
        ...prev,
        coins: data.user.coins,
        challengeCoins: data.user.challenge_coins || 0,
        energy: data.user.energy,
        totalTaps: data.user.total_taps,
        tapMultiplier: data.user.tap_multiplier,
        tapMultiplierEndTime: data.user.tap_multiplier_end_time,
        autoBotActiveUntil: data.user.auto_bot_active_until,
        adsWatchedToday: data.user.ads_watched_today,
        lastUpdateTime: Date.now(),
      }));

    } catch (error) {
      console.error('Sync failed, restoring queue', error);
      // Restore queue on failure to retry later
      tapQueue.current = [...tapsToSync, ...tapQueue.current];
    } finally {
      isSyncing.current = false;
    }
  }, [isLoaded]);

  // Periodic Sync every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => syncWithServer(), 5000);
    return () => clearInterval(interval);
  }, [syncWithServer]);

  // Client-side Logic: Energy Regen & Bot Earnings
  useEffect(() => {
    if (!isLoaded) return;

    const interval = setInterval(() => {
      setState(prev => {
        const now = Date.now();
        let newEnergy = prev.energy;
        let newCoins = prev.coins;
        let newChallengeCoins = prev.challengeCoins;
        
        // Energy Regen
        const timePassedSec = Math.max(0, (now - prev.lastUpdateTime) / 1000);
        if (prev.energy < prev.maxEnergy) {
          const regenRate = prev.maxEnergy / 1800; // Full in 30 mins
          const recovered = timePassedSec * regenRate;
          newEnergy = Math.min(prev.maxEnergy, prev.energy + recovered);
        }

        // Bot Earnings
        if (prev.autoBotActiveUntil > now) {
          const botEarnings = timePassedSec * 0.5;
          newCoins += botEarnings;
          newChallengeCoins += botEarnings;
        }

        // Check Multiplier Expiry
        let newMultiplier = prev.tapMultiplier;
        if (prev.tapMultiplierEndTime > 0 && prev.tapMultiplierEndTime <= now) {
          newMultiplier = 1;
        }

        // Only update if something changed to save renders
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

  // FIX 1: Robust Tap Function with Debounce
  const tap = useCallback((amount: number) => {
    const now = Date.now();
    
    // Prevent double taps within 50ms (Anti-cheat & UX fix)
    if (now - lastTapTimeRef.current < 50) {
      return false;
    }

    let success = false;

    setState(prev => {
      if (prev.energy >= 1) {
        success = true;
        lastTapTimeRef.current = now; // Update last tap time only on success

        const isMultiplierActive = prev.tapMultiplierEndTime > now;
        const multiplier = isMultiplierActive ? prev.tapMultiplier : 1;
        const totalAmount = amount * multiplier;
        
        // Queue for server sync
        tapQueue.current.push({ t: now, a: totalAmount });

        return {
          ...prev,
          coins: prev.coins + totalAmount,
          challengeCoins: prev.challengeCoins + totalAmount,
          energy: prev.energy - 1,
          totalTaps: prev.totalTaps + 1,
          // Do not update lastUpdateTime here to avoid resetting regen logic immediately
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
        const blockId = state.adsgramBlockId || process.env.NEXT_PUBLIC_ADSGRAM_BLOCK_ID || '';
        if (!blockId) throw new Error('Adsgram Block ID missing');
        
        const AdController = window.Adsgram.init({ blockId });
        try {
          await AdController.show();
          return true;
        } catch (e) {
          console.error("Adsgram skipped or error", e);
          return false;
        }
      } else {
        // Fallback for testing without Adsgram integration
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

  // FIX 2 & 3: Optimistic Updates & Disable Logic
  const watchAdForMultiplier = async () => {
    // Prevent action if already active
    if (state.tapMultiplierEndTime > Date.now()) return;

    const success = await showAd('Quad Strike (x4)', 'Watch ad to get x4 multiplier for 5 mins + 1000 Coins!');
    if (success) {
      const now = Date.now();
      // Immediate Local Update (No Refresh needed)
      setState(prev => ({
        ...prev,
        tapMultiplier: 4,
        tapMultiplierEndTime: now + 5 * 60 * 1000,
        coins: prev.coins + 1000,
        challengeCoins: prev.challengeCoins + 1000
      }));
      // Sync to DB
      await syncWithServer('multiplier');
    }
  };

  const watchAdForEnergy = async () => {
    if (state.energy >= state.maxEnergy) return;
    const success = await showAd('Full Energy', 'Watch ad to refill energy + 1000 Coins!');
    if (success) {
      setState(prev => ({
        ...prev,
        energy: prev.maxEnergy,
        coins: prev.coins + 1000,
        challengeCoins: prev.challengeCoins + 1000
      }));
      await syncWithServer('energy');
    }
  };

  const watchAdForBot = async () => {
    const success = await showAd('Auto-Bot', 'Watch ad to activate bot for 6h + 1000 Coins!');
    if (success) {
      const now = Date.now();
      setState(prev => ({
        ...prev,
        autoBotActiveUntil: now + 6 * 60 * 60 * 1000,
        coins: prev.coins + 1000,
        challengeCoins: prev.challengeCoins + 1000
      }));
      await syncWithServer('bot');
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
          challengeCoins: data.user.challenge_coins || 0,
        }));
      }
    } catch (e) {
      console.error('Task claim error:', e);
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

  if (error) {
    return (
      <div className="min-h-screen bg-[#050505] flex flex-col items-center justify-center text-white p-6 text-center">
        <AlertCircle className="text-red-500 mb-4" size={64} />
        <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
        <p className="text-zinc-400">{error}</p>
        <p className="text-zinc-600 text-xs mt-8">Secure Production Mode</p>
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
          if (fallbackAd.resolve) {
            fallbackAd.resolve(success);
          }
        }}
      />
    </GameContext.Provider>
  );
};
