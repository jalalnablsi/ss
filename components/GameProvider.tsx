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

  // --- ANTI-CHEAT & SUPABASE SYNC QUEUE ---
  const tapQueue = useRef<{ t: number; a: number }[]>([]);
  const isSyncing = useRef(false);

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

        // Authenticate with Backend
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
        
        // Map backend user to frontend state
        setState({
          coins: data.user.coins,
          energy: data.user.energy,
          maxEnergy: data.user.max_energy,
          tapMultiplier: data.user.tap_multiplier,
          tapMultiplierEndTime: data.user.tap_multiplier_end_time,
          autoBotActiveUntil: data.user.auto_bot_active_until,
          adsWatchedToday: data.user.ads_watched_today,
          lastAdWatchDate: data.user.last_ad_watch_date,
          lastUpdateTime: data.serverTime,
          totalTaps: data.user.total_taps,
          walletConnected: data.user.wallet_connected,
          walletAddress: data.user.wallet_address,
          referralsCount: data.user.referrals_count,
          referralsActivated: data.user.referrals_activated,
          referralCoinsEarned: data.user.referral_coins_earned,
        });
        
        setCompletedTasks(data.user.completed_tasks || []);

        setIsLoaded(true);
      } catch (err) {
        console.error('Init error:', err);
        setError('An unexpected error occurred during initialization.');
      }
    };

    initApp();
  }, []);

  const syncWithSupabase = useCallback(async (adWatchedType?: string) => {
    if (!isLoaded || (tapQueue.current.length === 0 && !adWatchedType) || isSyncing.current) return;
    isSyncing.current = true;

    const tapsToSync = [...tapQueue.current];
    tapQueue.current = [];

    try {
      const initData = window.Telegram?.WebApp?.initData;
      if (!initData) throw new Error('No initData');

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
      
      // Update state with server truth
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

    } catch (error) {
      console.error('Sync failed, restoring queue', error);
      tapQueue.current = [...tapsToSync, ...tapQueue.current];
    } finally {
      isSyncing.current = false;
    }
  }, [isLoaded]);

  // Periodic Sync
  useEffect(() => {
    const interval = setInterval(() => syncWithSupabase(), 3000);
    return () => clearInterval(interval);
  }, [syncWithSupabase]);

  // Handle TON Wallet Connection Reward
  useEffect(() => {
    const handleWalletConnect = async () => {
      if (isLoaded && wallet && !state.walletConnected) {
        // Optimistic UI update
        setState(prev => ({
          ...prev,
          walletConnected: true,
          walletAddress: wallet.account.address,
        }));
        
        // Claim task on backend
        try {
          const initData = window.Telegram?.WebApp?.initData;
          if (initData && !completedTasks.includes('connect_wallet')) {
            const response = await fetch('/api/tasks', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ initData, taskId: 'connect_wallet' }),
            });
            
            if (response.ok) {
              const data = await response.json();
              setCompletedTasks(data.user.completed_tasks || []);
              setState(prev => ({
                ...prev,
                coins: data.user.coins,
                walletConnected: true,
                walletAddress: wallet.account.address,
              }));
            }
          }
        } catch (e) {
          console.error('Failed to claim wallet reward', e);
        }
      } else if (isLoaded && !wallet && state.walletConnected) {
        setState(prev => ({
          ...prev,
          walletConnected: false,
          walletAddress: null,
        }));
      }
    };

    handleWalletConnect();
  }, [wallet, isLoaded, state.walletConnected, completedTasks]);

  // Client-side optimistic updates (Energy regen & Bot earnings)
  useEffect(() => {
    if (!isLoaded) return;

    const interval = setInterval(() => {
      setState(prev => {
        const now = Date.now();
        let newEnergy = prev.energy;
        let newCoins = prev.coins;
        
        const timePassedSec = (now - prev.lastUpdateTime) / 1000;
        const energyToAdd = timePassedSec * (500 / 1800);
        
        if (prev.energy < prev.maxEnergy) {
          newEnergy = Math.min(prev.maxEnergy, prev.energy + energyToAdd);
        }

        if (prev.autoBotActiveUntil > now) {
          newCoins += timePassedSec * 0.5;
        }

        let newMultiplier = prev.tapMultiplier;
        if (prev.tapMultiplierEndTime > 0 && prev.tapMultiplierEndTime < now) {
          newMultiplier = 1;
        }

        return {
          ...prev,
          coins: newCoins,
          energy: newEnergy,
          tapMultiplier: newMultiplier,
          lastUpdateTime: now,
        };
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isLoaded]);

  const [lastTapTime, setLastTapTime] = useState(0);

  const tap = useCallback((amount: number) => {
    const now = Date.now();
    if (now - lastTapTime < 60) {
      return false; // Anti-cheat: Max ~15 taps per second
    }
    setLastTapTime(now);

    let success = false;
    setState(prev => {
      if (prev.energy >= 1) {
        success = true;
        const multiplier = prev.tapMultiplierEndTime > now ? prev.tapMultiplier : 1;
        const totalAmount = amount * multiplier;
        
        tapQueue.current.push({ t: now, a: totalAmount });

        return {
          ...prev,
          coins: prev.coins + totalAmount,
          energy: prev.energy - 1,
          totalTaps: prev.totalTaps + 1,
          lastUpdateTime: now,
        };
      }
      return prev;
    });
    return success;
  }, [lastTapTime]);

  const showAd = async (title: string, description: string): Promise<boolean> => {
    setIsWatchingAd(true);
    try {
      if (window.Adsgram) {
        const blockId = process.env.NEXT_PUBLIC_ADSGRAM_BLOCK_ID || 'test-block-id';
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
    if (success) {
      await syncWithSupabase('multiplier');
    }
  };

  const watchAdForEnergy = async () => {
    const success = await showAd('Full Energy Refill', 'Watch this ad to instantly restore your energy.');
    if (success) {
      await syncWithSupabase('energy');
    }
  };

  const watchAdForBot = async () => {
    const success = await showAd('Auto-Tap Bot', 'Watch this ad to activate or progress the Auto-Bot.');
    if (success) {
      await syncWithSupabase('bot');
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
        }));
      } else {
        console.error('Failed to claim task');
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
    // In a real app, send this to a dedicated /api/referrals endpoint
  }, []);

  if (error) {
    return (
      <div className="min-h-screen bg-[#050505] flex flex-col items-center justify-center text-white p-6 text-center">
        <AlertCircle className="text-red-500 mb-4" size={64} />
        <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
        <p className="text-zinc-400">{error}</p>
        <p className="text-zinc-500 text-sm mt-8">Production Mode Active</p>
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
