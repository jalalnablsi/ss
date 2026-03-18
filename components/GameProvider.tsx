'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { gameState } from '@/lib/gameState';

interface GameContextType {
  coins: number;
  energy: number;
  maxEnergy: number;
  tapMultiplier: number;
  tapMultiplierEndTime: number;
  autoBotActiveUntil: number;
  isWatchingAd: boolean;
  watchAdForMultiplier: () => Promise<void>;
  watchAdForEnergy: () => Promise<void>;
  watchAdForBot: () => Promise<void>;
}

const GameContext = createContext<GameContextType | null>(null);

export const useGame = () => {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame must be used within GameProvider');
  return ctx;
};

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState({
    coins: 0,
    energy: 500,
    maxEnergy: 500,
    tapMultiplier: 1,
    tapMultiplierEndTime: 0,
    autoBotActiveUntil: 0,
    isWatchingAd: false
  });

  // Initialize
  useEffect(() => {
    const init = async () => {
      try {
        const res = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            initData: window.Telegram?.WebApp?.initData 
          }),
        });
        
        if (res.ok) {
          const data = await res.json();
          setState(prev => ({ ...prev, ...data.user }));
        }
      } catch (e) {
        console.error('Init failed:', e);
      }
    };
    
    init();
  }, []);

  // Ad functions
  const showAd = async (type: string): Promise<boolean> => {
    setState(prev => ({ ...prev, isWatchingAd: true }));
    
    try {
      // Try Adsgram
      if (window.Adsgram) {
        await window.Adsgram.init({ 
          blockId: process.env.NEXT_PUBLIC_ADSGRAM_BLOCK_ID || '25333' 
        }).show();
        return true;
      }
      
      // Fallback: simulate ad
      await new Promise(r => setTimeout(r, 1000));
      return true;
    } catch (e) {
      console.error('Ad error:', e);
      return false;
    } finally {
      setState(prev => ({ ...prev, isWatchingAd: false }));
    }
  };

  const watchAdForMultiplier = async () => {
    if (await showAd('multiplier')) {
      // Sync with server
      await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          initData: window.Telegram?.WebApp?.initData,
          adWatchedType: 'multiplier'
        }),
      });
      
      // Update local state
      setState(prev => ({
        ...prev,
        tapMultiplier: 4,
        tapMultiplierEndTime: Date.now() + 300000
      }));
    }
  };

  const watchAdForEnergy = async () => {
    if (await showAd('energy')) {
      await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          initData: window.Telegram?.WebApp?.initData,
          adWatchedType: 'energy'
        }),
      });
      
      setState(prev => ({ ...prev, energy: prev.maxEnergy }));
    }
  };

  const watchAdForBot = async () => {
    if (await showAd('bot')) {
      await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          initData: window.Telegram?.WebApp?.initData,
          adWatchedType: 'bot'
        }),
      });
      
      setState(prev => ({
        ...prev,
        autoBotActiveUntil: Date.now() + 21600000
      }));
    }
  };

  return (
    <GameContext.Provider value={{
      ...state,
      watchAdForMultiplier,
      watchAdForEnergy,
      watchAdForBot
    }}>
      {children}
    </GameContext.Provider>
  );
}
