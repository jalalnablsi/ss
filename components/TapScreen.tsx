'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence, useAnimationFrame } from 'framer-motion';
import { gameState } from '@/lib/gameState';
import { Zap, Bot, Sparkles, Gauge } from 'lucide-react';

// --- أنواع الجسيمات المحسّنة ---
interface Particle {
  id: number;
  x: number;
  y: number;
  value: number;
  velocityX: number;
  velocityY: number;
  opacity: number;
  scale: number;
  rotation: number;
  color: string;
}

export function TapScreen() {
  // State محسّن
  const [displayCoins, setDisplayCoins] = useState(0);
  const [displayEnergy, setDisplayEnergy] = useState(500);
  const [maxEnergy, setMaxEnergy] = useState(500);
  const [tapMultiplier, setTapMultiplier] = useState(1);
  const [multiplierEndTime, setMultiplierEndTime] = useState(0);
  const [botActiveUntil, setBotActiveUntil] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  
  // Particles
  const [particles, setParticles] = useState<Particle[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const particleIdRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastTapTimeRef = useRef(0);
  const touchPointsRef = useRef<Map<number, { x: number; y: number }>>(new Map());

  // Animation Frame للـ Particles (60fps)
  useAnimationFrame(() => {
    if (particlesRef.current.length === 0) return;

    particlesRef.current = particlesRef.current
      .map(p => ({
        ...p,
        y: p.y + p.velocityY,
        x: p.x + p.velocityX,
        velocityY: p.velocityY + 0.3, // Gravity أخف
        opacity: p.opacity - 0.015,
        scale: p.scale + 0.01,
        rotation: p.rotation + 2
      }))
      .filter(p => p.opacity > 0);

    setParticles([...particlesRef.current]);
  });

  // تهيئة اللعبة
  useEffect(() => {
    const init = async () => {
      try {
        const response = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            initData: window.Telegram?.WebApp?.initData 
          }),
        });

        if (response.ok) {
          const data = await response.json();
          
          setDisplayCoins(data.user.coins);
          setDisplayEnergy(data.user.energy);
          setMaxEnergy(data.user.maxEnergy);
          setTapMultiplier(data.user.tapMultiplier);
          setMultiplierEndTime(data.user.tapMultiplierEndTime);
          setBotActiveUntil(data.user.autoBotActiveUntil);

          // تحديث GameState
          gameState.setServerState(
            data.user.coins, 
            data.user.energy, 
            data.user.maxEnergy
          );
        }
      } catch (e) {
        console.error('Init failed:', e);
      }
    };

    init();

    // الاستماع لتحديثات GameState
    gameState.setCallbacks({
      onStateChange: (state) => {
        const pending = gameState.getPendingStats();
        
        // عرض سلس مع الـ pending
        setDisplayCoins(state.localCoins + pending.pendingCoins);
        setDisplayEnergy(Math.max(0, state.localEnergy - pending.pendingEnergy));
        setIsSyncing(state.isSyncing);
      },
      onSyncStart: () => setIsSyncing(true),
      onSyncEnd: () => setIsSyncing(false)
    });

    return () => {
      gameState.destroy();
    };
  }, []);

  // معالج اللمس المحسّن (Multi-touch)
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    
    const now = Date.now();
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const touches = Array.from(e.touches);
    
    // ✅ Anti-Spam: منع الضغط السريع جداً
    if (now - lastTapTimeRef.current < 30) {
      return; // تجاهل الضغطات السريعة جداً (أقل من 30ms)
    }
    lastTapTimeRef.current = now;

    // معالجة كل الأصابع (Multi-touch)
    touches.forEach((touch) => {
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;
      
      // التأكد من أن اللمسة داخل المنطقة
      if (x < 0 || x > rect.width || y < 0 || y > rect.height) return;

      const isMultiplierActive = multiplierEndTime > now;
      const multiplier = isMultiplierActive ? tapMultiplier : 1;

      // إرسال للـ GameState (مع Anti-Cheat)
      const accepted = gameState.addTap(x, y, multiplier);
      
      if (!accepted) return;

      // إنشاء Particle (مرئي فقط)
      const colors = ['#facc15', '#fbbf24', '#f59e0b', '#f97316'];
      const color = colors[Math.floor(Math.random() * colors.length)];
      
      const particle: Particle = {
        id: particleIdRef.current++,
        x,
        y,
        value: multiplier,
        velocityX: (Math.random() - 0.5) * 3,
        velocityY: -6 - Math.random() * 4,
        opacity: 1,
        scale: 0.5 + Math.random() * 0.3,
        rotation: Math.random() * 30 - 15,
        color
      };

      particlesRef.current.push(particle);
      
      // Haptic Feedback (خفيف)
      window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.('light');
    });

    // تحديث الـ particles
    setParticles([...particlesRef.current]);
  }, [tapMultiplier, multiplierEndTime]);

  // معالج الماوس (للتطوير)
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return; // Left click only
    
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (x < 0 || x > rect.width || y < 0 || y > rect.height) return;

    const now = Date.now();
    if (now - lastTapTimeRef.current < 30) return;
    lastTapTimeRef.current = now;

    const isMultiplierActive = multiplierEndTime > now;
    const multiplier = isMultiplierActive ? tapMultiplier : 1;

    const accepted = gameState.addTap(x, y, multiplier);
    if (!accepted) return;

    const colors = ['#facc15', '#fbbf24', '#f59e0b', '#f97316'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    
    const particle: Particle = {
      id: particleIdRef.current++,
      x,
      y,
      value: multiplier,
      velocityX: (Math.random() - 0.5) * 3,
      velocityY: -6 - Math.random() * 4,
      opacity: 1,
      scale: 0.5 + Math.random() * 0.3,
      rotation: Math.random() * 30 - 15,
      color
    };

    particlesRef.current.push(particle);
    setParticles([...particlesRef.current]);
  }, [tapMultiplier, multiplierEndTime]);

  // حساب نسبة الطاقة
  const energyPercent = (displayEnergy / maxEnergy) * 100;
  const isMultiplierActive = multiplierEndTime > Date.now();
  const isBotActive = botActiveUntil > Date.now();

  // الوقت المتبقي للمضاعف
  const multiplierTimeLeft = isMultiplierActive 
    ? Math.ceil((multiplierEndTime - Date.now()) / 1000)
    : 0;

  return (
    <div 
      ref={containerRef}
      className="relative flex flex-col items-center justify-between h-full w-full pt-4 pb-28 px-4 overflow-hidden select-none touch-none"
      onTouchStart={handleTouchStart}
      onMouseDown={handleMouseDown}
    >
      {/* Background Effects */}
      <div className="absolute inset-0 bg-gradient-to-b from-yellow-500/5 via-transparent to-transparent pointer-events-none" />
      <div className="absolute top-[-20%] left-[-20%] w-[140%] h-[140%] bg-[radial-gradient(circle_at_50%_40%,_rgba(250,204,21,0.08)_0%,_transparent_60%)] pointer-events-none" />

      {/* Top Bar - إحصائيات سريعة */}
      <div className="w-full flex justify-between items-start z-10 px-2">
        {/* Multiplier Status */}
        <div className="flex gap-2">
          <AnimatePresence>
            {isMultiplierActive && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8, x: -20 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.8, x: -20 }}
                className="bg-gradient-to-r from-yellow-500/20 to-orange-500/20 backdrop-blur-xl border border-yellow-500/30 rounded-xl px-3 py-1.5 flex items-center gap-2"
              >
                <Zap size={16} className="text-yellow-400 fill-yellow-400" />
                <span className="text-yellow-400 font-bold text-sm">{tapMultiplier}x</span>
                <span className="text-yellow-400/70 text-xs">{multiplierTimeLeft}s</span>
              </motion.div>
            )}

            {isBotActive && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8, x: -20 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.8, x: -20 }}
                className="bg-gradient-to-r from-blue-500/20 to-cyan-500/20 backdrop-blur-xl border border-blue-500/30 rounded-xl px-3 py-1.5 flex items-center gap-2"
              >
                <Bot size={16} className="text-blue-400" />
                <span className="text-blue-400 font-bold text-sm">Auto</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Sync Indicator */}
        {isSyncing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-black/40 backdrop-blur-xl rounded-full px-3 py-1.5 flex items-center gap-2"
          >
            <div className="w-4 h-4 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-zinc-300">Syncing</span>
          </motion.div>
        )}
      </div>

      {/* Main Display */}
      <div className="flex flex-col items-center z-10 mt-8">
        <span className="text-zinc-400 text-xs font-medium uppercase tracking-widest mb-1">
          Total Balance
        </span>
        
        <div className="relative">
          <motion.h1 
            className="text-7xl font-black text-white drop-shadow-[0_0_30px_rgba(250,204,21,0.3)] tabular-nums tracking-tight"
            animate={isSyncing ? { scale: [1, 1.02, 1] } : {}}
            transition={{ duration: 0.4, repeat: isSyncing ? Infinity : 0 }}
          >
            {Math.floor(displayCoins).toLocaleString()}
          </motion.h1>

          {/* Pending Indicator */}
          {gameState.getPendingStats().totalPending > 0 && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="absolute -top-2 -right-8 bg-yellow-500 text-black text-xs font-bold px-2 py-1 rounded-full"
            >
              +{gameState.getPendingStats().totalPending}
            </motion.div>
          )}
        </div>

        {/* Stats Row */}
        <div className="flex gap-4 mt-4 text-sm">
          <div className="flex items-center gap-1 text-zinc-400">
            <Gauge size={16} />
            <span>{gameState.getState().totalTapsInSession} taps</span>
          </div>
        </div>
      </div>

      {/* Tap Button */}
      <div className="relative flex-1 flex items-center justify-center my-4">
        <motion.div
          whileTap={{ scale: 0.92 }}
          transition={{ type: "spring", stiffness: 400, damping: 15 }}
          className="relative w-64 h-64 md:w-72 md:h-72 cursor-pointer"
          style={{ willChange: 'transform' }}
        >
          {/* Glow Effect */}
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-yellow-400/30 via-yellow-500/30 to-amber-600/30 blur-3xl animate-pulse" />
          
          {/* Main Button */}
          <div className="relative w-full h-full rounded-full bg-gradient-to-br from-yellow-400 via-yellow-500 to-amber-600 p-1 shadow-[0_20px_40px_rgba(0,0,0,0.4),inset_0_2px_10px_rgba(255,255,255,0.6)]">
            <div className="w-full h-full rounded-full bg-gradient-to-br from-yellow-300 to-amber-500 flex items-center justify-center shadow-inner relative overflow-hidden">
              
              {/* Shine Effect */}
              <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/40 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
              
              {/* Icon */}
              <span className="text-8xl font-black text-white drop-shadow-lg select-none">
                💎
              </span>

              {/* Ripple Effect على الضغط */}
              <AnimatePresence>
                {particles.slice(0, 2).map((_, i) => (
                  <motion.div
                    key={`ripple-${i}`}
                    initial={{ scale: 0.8, opacity: 0.5 }}
                    animate={{ scale: 1.8, opacity: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.8, delay: i * 0.1 }}
                    className="absolute inset-0 rounded-full border-4 border-white/50"
                  />
                ))}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>

        {/* Floating Particles */}
        <AnimatePresence>
          {particles.map((p) => (
            <motion.div
              key={p.id}
              initial={{ opacity: 1, scale: 0.5, y: p.y, x: p.x, rotate: 0 }}
              animate={{ 
                opacity: p.opacity, 
                scale: p.scale, 
                y: p.y, 
                x: p.x,
                rotate: p.rotation
              }}
              className="absolute pointer-events-none z-50"
              style={{ left: 0, top: 0 }}
            >
              <div className="flex flex-col items-center">
                <span 
                  className="text-3xl font-black drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]"
                  style={{ color: p.color }}
                >
                  +{p.value}
                </span>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Energy Bar - محسّن */}
      <div className="w-full max-w-sm px-4 z-10 mb-4">
        <div className="flex justify-between items-center mb-2">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-yellow-400/20 rounded-lg">
              <Zap size={18} className="text-yellow-400 fill-yellow-400" />
            </div>
            <span className="text-sm font-medium text-zinc-300">
              Energy
            </span>
          </div>
          <span className="text-sm font-bold text-white tabular-nums">
            {Math.floor(displayEnergy)} / {maxEnergy}
          </span>
        </div>
        
        <div className="h-3 bg-[#1a1a1a] rounded-full overflow-hidden border border-white/10">
          <motion.div 
            className="h-full rounded-full relative overflow-hidden"
            style={{
              background: energyPercent < 30 
                ? 'linear-gradient(90deg, #ef4444, #f87171)' 
                : 'linear-gradient(90deg, #fbbf24, #facc15, #fde047)',
              width: `${energyPercent}%`
            }}
            initial={false}
            animate={{ width: `${energyPercent}%` }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          >
            {/* Shimmer */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent -translate-x-full animate-[shimmer_2s_infinite]" />
          </motion.div>
        </div>

        {/* Energy Regen Info */}
        <div className="flex justify-between mt-1 text-[10px] text-zinc-500">
          <span>⚡ +1 per 2s</span>
          <span>Max in 30m</span>
        </div>
      </div>
    </div>
  );
}
