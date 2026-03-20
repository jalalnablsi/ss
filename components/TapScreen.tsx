'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useGame } from './GameProvider';
import { Zap, Bot, ShieldAlert } from 'lucide-react';

interface FloatingNumber {
  id: number;
  x: number;
  y: number;
  value: number;
}

// ✅ إصلاح: إضافة Debounce للضغط السريع
const DEBOUNCE_MS = 80; // 80ms بين كل ضغطة
const MAX_TAPS_PER_SECOND = 12; // حد أقصى 12 ضغطة/ثانية

export function TapScreen() {
  const { coins, energy, maxEnergy, tap, tapMultiplier, tapMultiplierEndTime, autoBotActiveUntil } = useGame();
  const [floatingNumbers, setFloatingNumbers] = useState<FloatingNumber[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const numberIdRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // ✅ إصلاح: Refs للتحكم في الضغط
  const lastTapTimeRef = useRef(0);
  const tapCountRef = useRef(0);
  const lastSecondRef = useRef(Date.now());
  const isProcessingRef = useRef(false);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  // ✅ إصلاح: دالة معالجة الضغط مع Debounce و Rate Limiting
  const processTap = useCallback((clientX: number, clientY: number) => {
    const now = Date.now();
    
    // Rate limiting: التحقق من عدد الضغطات في الثانية
    if (now - lastSecondRef.current >= 1000) {
      tapCountRef.current = 0;
      lastSecondRef.current = now;
    }
    
    if (tapCountRef.current >= MAX_TAPS_PER_SECOND) {
      return; // تجاوز الحد المسموح
    }

    // Debounce: التحقق من الوقت بين الضغطات
    if (now - lastTapTimeRef.current < DEBOUNCE_MS) {
      return;
    }

    if (energy < 1) return;
    
    // ✅ إصلاح: منع المعالجة المتزامنة
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    const success = tap(1);
    
    if (success) {
      lastTapTimeRef.current = now;
      tapCountRef.current++;
      
      const rect = containerRef.current?.getBoundingClientRect();
      const x = rect ? clientX - rect.left : clientX;
      const y = rect ? clientY - rect.top : clientY;

      const isMultiplierActive = tapMultiplierEndTime > Date.now();
      const value = 1 * (isMultiplierActive ? tapMultiplier : 1);

      const newNumber = {
        id: numberIdRef.current++,
        x,
        y,
        value,
      };

      setFloatingNumbers(prev => {
        const updated = [...prev, newNumber];
        if (updated.length > 6) { // ✅ تقليل العدد لتحسين الأداء
          return updated.slice(updated.length - 6);
        }
        return updated;
      });

      setTimeout(() => {
        setFloatingNumbers(prev => prev.filter(n => n.id !== newNumber.id));
      }, 500); // ✅ تقليل وقت العرض
    }

    // ✅ إصلاح: إطلاق القفل بعد فترة قصيرة
    setTimeout(() => {
      isProcessingRef.current = false;
    }, 50);
  }, [tap, tapMultiplier, tapMultiplierEndTime, energy]);

  // ✅ إصلاح: معالجة أفضل للـ Touch Events
  const handleTap = useCallback((e: React.TouchEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault(); // ✅ منع السلوك الافتراضي دائماً
    
    if ('touches' in e && e.touches.length > 0) {
      // ✅ معالجة Multi-touch بشكل أفضل
      const touches = Array.from(e.changedTouches);
      touches.forEach((touch, index) => {
        // تأخير بسيط بين كل touch لتجنب الضغط المزدوج
        setTimeout(() => {
          processTap(touch.clientX, touch.clientY);
        }, index * 30);
      });
    } else if ('clientX' in e) {
      processTap(e.clientX, e.clientY);
    }
  }, [processTap]);

  // ✅ إصلاح: منع الضغط المزدوج على الأجهزة المحمولة
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const preventDoubleTap = (e: TouchEvent) => {
      if (e.touches.length > 1) {
        e.preventDefault();
      }
    };

    container.addEventListener('touchstart', preventDoubleTap, { passive: false });
    
    return () => {
      container.removeEventListener('touchstart', preventDoubleTap);
    };
  }, []);

  const formatCoins = (num: number) => {
    return Math.floor(num).toLocaleString('en-US');
  };

  const isMultiplierActive = tapMultiplierEndTime > now;
  const isBotActive = autoBotActiveUntil > now;
  const currentMultiplierDisplay = isMultiplierActive ? `x${tapMultiplier}` : '';

  return (
    <div className="flex flex-col items-center justify-between h-full w-full pt-2 pb-28 px-4 relative overflow-hidden select-none">
      
      {/* Background Effects */}
      <div className="absolute top-[-10%] left-[-10%] w-[120%] h-[120%] bg-[radial-gradient(circle_at_50%_40%,_rgba(250,204,21,0.08)_0%,_transparent_60%)] pointer-events-none" />

      {/* Stats Area */}
      <div className="w-full flex flex-col items-center space-y-4 z-10 mt-2">
        
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
        style={{ touchAction: 'manipulation' }} // ✅ تحسين الأداء على الموبايل
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
            initial={false}
            animate={{ width: `${(energy / maxEnergy) * 100}%` }}
            transition={{ type: 'tween', ease: 'linear', duration: 0.1 }}
          />
        </div>
      </div>
    </div>
  );
}
