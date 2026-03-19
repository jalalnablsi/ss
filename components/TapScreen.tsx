'use client';

import React, { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useGame } from './GameProvider';
import { Zap, Bot, ShieldAlert, ExternalLink, Sparkles } from 'lucide-react';

interface FloatingNumber {
  id: number;
  x: number;
  y: number;
  value: number;
}

export function TapScreen() {
  const { coins, energy, maxEnergy, tap, tapMultiplier, tapMultiplierEndTime, autoBotActiveUntil } = useGame();
  const [floatingNumbers, setFloatingNumbers] = useState<FloatingNumber[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const numberIdRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const processTap = useCallback((clientX: number, clientY: number) => {
    // ✅ فحص مبكر للطاقة
    if (energy < 1) return;
    
    const success = tap(1);
    if (!success) return; 

    const rect = containerRef.current?.getBoundingClientRect();
    const x = rect ? clientX - rect.left : clientX;
    const y = rect ? clientY - rect.top : clientY;

    const isMultiplierActive = tapMultiplierEndTime > Date.now();
    // ✅ استخدام tapMultiplier مباشرة من الـ context
    const value = 1 * (isMultiplierActive ? tapMultiplier : 1);

    const newNumber = {
      id: numberIdRef.current++,
      x,
      y,
      value,
    };

    setFloatingNumbers(prev => {
      const updated = [...prev, newNumber];
      if (updated.length > 8) {
        return updated.slice(updated.length - 8);
      }
      return updated;
    });

    setTimeout(() => {
      setFloatingNumbers(prev => prev.filter(n => n.id !== newNumber.id));
    }, 600);
  }, [tap, tapMultiplier, tapMultiplierEndTime, energy]);

  const handleTap = useCallback((e: React.TouchEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>) => {
    if (e.type === 'touchstart') {
      e.preventDefault();
    }

    if ('touches' in e) {
      Array.from(e.changedTouches).forEach(touch => {
        processTap(touch.clientX, touch.clientY);
      });
    } else {
      processTap(e.clientX, e.clientY);
    }
  }, [processTap]);

  const formatCoins = (num: number) => {
    return Math.floor(num).toLocaleString('en-US');
  };

  const isMultiplierActive = tapMultiplierEndTime > now;
  const isBotActive = autoBotActiveUntil > now;
  
  // ✅ عرض الرقم الصحيح من الـ context
  const currentMultiplierDisplay = isMultiplierActive ? `x${tapMultiplier}` : '';

  return (
    <div className="flex flex-col items-center justify-between h-full w-full pt-4 pb-28 px-4 relative overflow-hidden">
      
      {/* Background Effects */}
      <div className="absolute top-[-10%] left-[-10%] w-[120%] h-[120%] bg-[radial-gradient(circle_at_50%_40%,_rgba(250,204,21,0.08)_0%,_transparent_60%)] pointer-events-none" />
      
      {/* Top Banner */}
      <div className="w-full max-w-sm bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-3 flex items-center justify-between z-20 shadow-lg cursor-pointer hover:bg-white/10 transition-colors">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shrink-0">
            <Sparkles size={18} className="text-white" />
          </div>
          <div>
            <div className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider">Sponsored</div>
            <div className="text-sm font-bold text-white">Play Web3 Quest</div>
          </div>
        </div>
        <ExternalLink size={16} className="text-zinc-500" />
      </div>

      {/* Stats Area */}
      <div className="w-full flex flex-col items-center space-y-6 z-10 mt-4">
        
        {/* Active Buffs */}
        <div className="flex gap-2 h-8 flex-wrap justify-center">
          <AnimatePresence>
            {isMultiplierActive && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="bg-orange-500/10 border border-orange-500/30 text-orange-400 px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 shadow-[0_0_15px_rgba(249,115,22,0.15)] backdrop-blur-md"
              >
                <Zap size={14} />
                {/* ✅ عرض الرقم الصحيح من الـ context */}
                <span>{currentMultiplierDisplay} Multiplier</span>
              </motion.div>
            )}
            {isBotActive && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="bg-blue-500/10 border border-blue-500/30 text-blue-400 px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 shadow-[0_0_15px_rgba(59,130,246,0.15)] backdrop-blur-md"
              >
                <Bot size={14} />
                <span>Auto-Bot Active</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Coin Balance */}
        <div className="flex flex-col items-center justify-center gap-1">
          <span className="text-zinc-400 text-sm font-medium">Total Balance</span>
          <div className="flex items-center justify-center gap-3">
            <h1 className="text-5xl font-black text-white drop-shadow-lg tabular-nums tracking-tight">
              {formatCoins(coins)}
            </h1>
          </div>
        </div>
      </div>

      {/* Tap Area */}
      <div 
        ref={containerRef}
        className="relative flex-1 w-full flex items-center justify-center touch-none my-4"
        onTouchStart={handleTap}
        onMouseDown={handleTap}
      >
        {/* Main Coin */}
        <motion.div
          whileTap={{ scale: 0.95 }}
          transition={{ type: "spring", stiffness: 400, damping: 15 }}
          className="relative z-10 w-72 h-72 rounded-full cursor-pointer select-none"
        >
          {/* Outer Glow */}
          <div className="absolute inset-0 rounded-full bg-yellow-500/20" />
          
          {/* Coin Body */}
          <div className="w-full h-full rounded-full bg-gradient-to-br from-yellow-300 via-yellow-500 to-amber-700 p-1 shadow-lg relative overflow-hidden flex items-center justify-center">
            {/* Inner Ring */}
            <div className="w-[90%] h-[90%] rounded-full border-4 border-yellow-200/30 bg-gradient-to-br from-yellow-400 to-amber-600 flex items-center justify-center">
              {/* Coin Symbol */}
              <span className="text-8xl font-black text-yellow-100">
                T
              </span>
            </div>
          </div>
        </motion.div>

        {/* Floating Numbers */}
        <AnimatePresence>
          {floatingNumbers.map(num => (
            <motion.div
              key={num.id}
              initial={{ opacity: 1, y: num.y - 40, x: num.x - 20, scale: 0.5 }}
              animate={{ opacity: 0, y: num.y - 120, scale: 1.2 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className="absolute z-50 text-4xl font-black text-white pointer-events-none"
              style={{ left: 0, top: 0 }}
            >
              +{num.value}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Energy Bar */}
      <div className="w-full max-w-sm px-4 z-10 space-y-3">
        <div className="flex justify-between items-end">
          <div className="flex items-center gap-1.5">
            <Zap size={20} className="text-yellow-400 fill-yellow-400" />
            <span className="text-lg font-bold text-white tabular-nums">{Math.floor(energy)} <span className="text-zinc-500 text-sm">/ {maxEnergy}</span></span>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-zinc-500 font-medium bg-white/5 px-2 py-1 rounded-md">
            <ShieldAlert size={12} />
            <span>Anti-Cheat On</span>
          </div>
        </div>
        
        {/* Energy Bar */}
        <div className="h-6 w-full bg-[#111] rounded-full overflow-hidden border border-white/10 p-1 shadow-inner relative">
          <motion.div 
            className="h-full bg-gradient-to-r from-yellow-600 via-yellow-400 to-yellow-300 rounded-full relative overflow-hidden"
            initial={{ width: `${(energy / maxEnergy) * 100}%` }}
            animate={{ width: `${(energy / maxEnergy) * 100}%` }}
            transition={{ type: 'tween', ease: 'linear', duration: 0.2 }}
          />
        </div>
      </div>
    </div>
  );
}
