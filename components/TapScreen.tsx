'use client';

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence, useAnimationFrame } from 'framer-motion';
import { gameState, LocalGameState } from '@/lib/gameState';
import { Zap, Bot, Sparkles } from 'lucide-react';

// --- Types ---
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
}

interface DisplayState {
  coins: number;
  energy: number;
  maxEnergy: number;
  tapMultiplier: number;
  tapMultiplierEndTime: number;
  autoBotActiveUntil: number;
  totalTaps: number;
}

// --- Component ---
export function TapScreen() {
  // Server State (يأتي من props أو context)
  const [serverState, setServerState] = useState<DisplayState>({
    coins: 0,
    energy: 500,
    maxEnergy: 500,
    tapMultiplier: 1,
    tapMultiplierEndTime: 0,
    autoBotActiveUntil: 0,
    totalTaps: 0
  });

  // Local Optimistic State
  const [localCoins, setLocalCoins] = useState(0);
  const [localEnergy, setLocalEnergy] = useState(500);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  
  // Refs للأداء
  const containerRef = useRef<HTMLDivElement>(null);
  const particleIdRef = useRef(0);
  const particlesRef = useRef<Particle[]>([]);
  const lastServerUpdateRef = useRef<number>(Date.now());

  // Initialize
  useEffect(() => {
    // جلب الحالة الأولية
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
          const user = data.user;
          
          setServerState({
            coins: user.coins,
            energy: user.energy,
            maxEnergy: user.max_energy,
            tapMultiplier: user.tap_multiplier,
            tapMultiplierEndTime: user.tap_multiplier_end_time,
            autoBotActiveUntil: user.auto_bot_active_until,
            totalTaps: user.total_taps
          });
          
          setLocalCoins(user.coins);
          setLocalEnergy(user.energy);
          lastServerUpdateRef.current = Date.now();
        }
      } catch (e) {
        console.error('Init failed:', e);
      }
    };

    init();

    // Setup GameState callbacks
    gameState.setCallbacks({
      onStateChange: (state: LocalGameState) => {
        // تحديث الـ UI المحلي فوراً
        setIsSyncing(state.isSyncing);
      },
      onSyncStart: () => setIsSyncing(true),
      onSyncEnd: (success) => {
        setIsSyncing(false);
        if (success) {
          // جلب التحديثات من السيرفر بعد النجاح
          refreshServerState();
        }
      }
    });

    // Background sync كل 5 ثواني
    const interval = setInterval(() => {
      gameState.forceSync();
      refreshServerState();
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  // Animation Frame للـ Particles (60fps)
  useAnimationFrame(() => {
    if (particlesRef.current.length === 0) return;

    particlesRef.current = particlesRef.current.map(p => ({
      ...p,
      y: p.y + p.velocityY,
      x: p.x + p.velocityX,
      velocityY: p.velocityY + 0.5, // Gravity
      opacity: p.opacity - 0.02,
      scale: p.scale + 0.02,
      rotation: p.rotation + 5
    })).filter(p => p.opacity > 0);

    setParticles([...particlesRef.current]);
  });

  const refreshServerState = async () => {
    try {
      const response = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          initData: window.Telegram?.WebApp?.initData,
          tapCount: 0, // فقط للحصول على التحديثات
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const user = data.user;
        
        // تنعيم الانتقال بدلاً من القفز المفاجئ
        setServerState(prev => ({
          coins: user.coins,
          energy: user.energy,
          maxEnergy: user.max_energy,
          tapMultiplier: user.tap_multiplier,
          tapMultiplierEndTime: user.tap_multiplier_end_time,
          autoBotActiveUntil: user.auto_bot_active_until,
          totalTaps: user.total_taps
        }));

        // إذا كان الفرق كبير، نصحح فوراً. إذا كان صغيراً، ننتظر الـ batch
        const coinDiff = user.coins - localCoins;
        if (Math.abs(coinDiff) > 100) {
          setLocalCoins(user.coins);
          setLocalEnergy(user.energy);
        }
        
        lastServerUpdateRef.current = Date.now();
      }
    } catch (e) {
      console.error('Refresh failed:', e);
    }
  };

  const handleTap = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    
    if (localEnergy <= 0) {
      // Vibration للخطأ
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('error');
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const touches = 'touches' in e ? Array.from(e.touches) : [{ clientX: (e as React.MouseEvent).clientX, clientY: (e as React.MouseEvent).clientY }];
    
    const now = Date.now();
    const isMultiplierActive = serverState.tapMultiplierEndTime > now;
    const multiplier = isMultiplierActive ? serverState.tapMultiplier : 1;

    touches.forEach((touch) => {
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;

      // إرسال للـ GameState (مع Anti-Cheat)
      const accepted = gameState.addTap(x, y, multiplier);
      
      if (!accepted) return;

      // تحديث محلي فوري (Optimistic)
      setLocalCoins(prev => prev + multiplier);
      setLocalEnergy(prev => Math.max(0, prev - 1));

      // إنشاء Particle
      const particle: Particle = {
        id: particleIdRef.current++,
        x,
        y,
        value: multiplier,
        velocityX: (Math.random() - 0.5) * 4,
        velocityY: -8 - Math.random() * 4,
        opacity: 1,
        scale: 0.5,
        rotation: Math.random() * 30 - 15
      };

      particlesRef.current.push(particle);
      setParticles([...particlesRef.current]);

      // Haptic
      window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.('light');
    });
  }, [localEnergy, serverState.tapMultiplier, serverState.tapMultiplierEndTime]);

  // حساب القيم النهائية للعرض
  const displayCoins = useMemo(() => {
    const pending = gameState.getPendingStats();
    return localCoins + pending.pendingCoins;
  }, [localCoins, isSyncing]);

  const displayEnergy = useMemo(() => {
    const pending = gameState.getPendingStats();
    return Math.max(0, localEnergy - pending.pendingEnergy);
  }, [localEnergy, isSyncing]);

  const isMultiplierActive = serverState.tapMultiplierEndTime > Date.now();
  const isBotActive = serverState.autoBotActiveUntil > Date.now();

  return (
    <div className="flex flex-col items-center justify-between h-full w-full pt-4 pb-28 px-4 relative overflow-hidden select-none touch-none">
      
      {/* Background Glow */}
      <div className="absolute top-[-10%] left-[-10%] w-[120%] h-[120%] bg-[radial-gradient(circle_at_50%_40%,_rgba(250,204,21,0.08)_0%,_transparent_60%)] pointer-events-none" />
      
      {/* Sponsored Banner */}
      <div className="w-full max-w-sm bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-3 flex items-center justify-between z-20 shadow-lg cursor-pointer hover:bg-white/10 transition-colors active:scale-95">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shrink-0 shadow-inner">
            <Sparkles size={18} className="text-white" />
          </div>
          <div>
            <div className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider">Sponsored</div>
            <div className="text-sm font-bold text-white">Daily Bonus</div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="w-full flex flex-col items-center space-y-4 z-10 mt-4">
        {/* Badges */}
        <div className="flex gap-2 h-8 flex-wrap justify-center">
          <AnimatePresence>
            {isMultiplierActive && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.8, y: -20 }}
                className="bg-gradient-to-r from-orange-500/20 to-red-500/20 border border-orange-500/40 text-orange-400 px-4 py-1.5 rounded-full text-xs font-bold flex items-center gap-2 shadow-[0_0_20px_rgba(249,115,22,0.3)] backdrop-blur-md"
              >
                <Zap size={14} className="fill-orange-400" />
                <span>x{serverState.tapMultiplier} ACTIVE</span>
                <span className="text-[10px] opacity-70">
                  {Math.ceil((serverState.tapMultiplierEndTime - Date.now()) / 1000)}s
                </span>
              </motion.div>
            )}
            
            {isBotActive && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.8, y: -20 }}
                className="bg-gradient-to-r from-blue-500/20 to-cyan-500/20 border border-blue-500/40 text-blue-400 px-4 py-1.5 rounded-full text-xs font-bold flex items-center gap-2 shadow-[0_0_20px_rgba(59,130,246,0.3)] backdrop-blur-md"
              >
                <Bot size={14} />
                <span>BOT ACTIVE</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Coins Display */}
        <div className="flex flex-col items-center justify-center gap-1">
          <span className="text-zinc-400 text-xs font-medium uppercase tracking-widest">Total Balance</span>
          <div className="relative">
            <motion.h1 
              className="text-6xl font-black text-white drop-shadow-[0_0_30px_rgba(250,204,21,0.3)] tabular-nums tracking-tight"
              animate={isSyncing ? { opacity: [1, 0.7, 1] } : {}}
              transition={{ duration: 0.5, repeat: isSyncing ? Infinity : 0 }}
            >
              {Math.floor(displayCoins).toLocaleString('en-US')}
            </motion.h1>
            {isSyncing && (
              <motion.div 
                className="absolute -right-8 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-yellow-400 border-t-transparent rounded-full"
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Tap Area */}
      <div 
        ref={containerRef}
        className="relative flex-1 w-full flex items-center justify-center touch-none my-4"
        onTouchStart={handleTap}
        onMouseDown={handleTap}
        style={{ touchAction: 'none' }}
      >
        {/* Tap Button */}
        <motion.div
          whileTap={{ scale: 0.92, rotate: 2 }}
          whileHover={{ scale: 1.02 }}
          transition={{ type: "spring", stiffness: 500, damping: 15 }}
          className="relative z-10 w-64 h-64 md:w-72 md:h-72 rounded-full cursor-pointer"
          style={{ willChange: 'transform' }}
        >
          {/* Glow Effect */}
          <div className="absolute inset-0 rounded-full bg-yellow-500/30 blur-3xl animate-pulse" />
          
          {/* Main Button */}
          <div className="relative w-full h-full rounded-full bg-gradient-to-br from-yellow-300 via-yellow-500 to-amber-600 p-1 shadow-[0_15px_50px_rgba(217,119,6,0.5),inset_0_4px_15px_rgba(255,255,255,0.5)] overflow-hidden flex items-center justify-center group">
            
            {/* Inner Circle */}
            <div className="w-[92%] h-[92%] rounded-full bg-gradient-to-br from-yellow-400 to-amber-600 flex items-center justify-center shadow-[inset_0_0_30px_rgba(0,0,0,0.2)] relative overflow-hidden">
              
              {/* Shine Effect */}
              <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/30 to-transparent -rotate-45 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
              
              {/* Text */}
              <span className="text-8xl font-black text-yellow-100 drop-shadow-[0_4px_8px_rgba(0,0,0,0.4)] select-none">
                T
              </span>
            </div>

            {/* Ripple Effect on Tap */}
            <AnimatePresence>
              {particles.slice(0, 3).map((_, i) => (
                <motion.div
                  key={`ripple-${i}`}
                  initial={{ scale: 0.8, opacity: 0.5 }}
                  animate={{ scale: 1.5, opacity: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.6, delay: i * 0.1 }}
                  className="absolute inset-0 rounded-full border-4 border-yellow-300/50"
                />
              ))}
            </AnimatePresence>
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
              style={{ 
                left: 0, 
                top: 0,
                willChange: 'transform, opacity'
              }}
            >
              <div className="flex flex-col items-center">
                <span className="text-4xl font-black text-yellow-400 drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
                  +{p.value}
                </span>
                <motion.div
                  initial={{ scaleX: 1 }}
                  animate={{ scaleX: 0 }}
                  transition={{ duration: 0.5 }}
                  className="h-1 w-12 bg-yellow-400/50 rounded-full mt-1"
                />
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Energy Bar */}
      <div className="w-full max-w-sm px-4 z-10 space-y-2 mb-2">
        <div className="flex justify-between items-end">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-yellow-400/20 rounded-lg">
              <Zap size={18} className="text-yellow-400 fill-yellow-400" />
            </div>
            <div className="flex flex-col">
              <span className="text-lg font-bold text-white tabular-nums leading-none">
                {Math.floor(displayEnergy)}
              </span>
              <span className="text-[10px] text-zinc-500 font-medium">
                / {serverState.maxEnergy} ENERGY
              </span>
            </div>
          </div>
          
          {isMultiplierActive && (
            <div className="text-[10px] text-orange-400 font-bold bg-orange-400/10 px-2 py-1 rounded-full">
              {serverState.tapMultiplier}x BOOST
            </div>
          )}
        </div>
        
        <div className="h-6 w-full bg-[#111] rounded-full overflow-hidden border border-white/10 p-1 shadow-inner relative">
          <motion.div 
            className="h-full relative overflow-hidden rounded-full"
            style={{
              background: displayEnergy < 50 
                ? 'linear-gradient(90deg, #ef4444, #f87171)' 
                : 'linear-gradient(90deg, #ca8a04, #facc15, #fde047)'
            }}
            initial={false}
            animate={{ width: `${(displayEnergy / serverState.maxEnergy) * 100}%` }}
            transition={{ type: 'tween', ease: 'linear', duration: 0.1 }}
          >
            {/* Shimmer */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent -translate-x-full animate-[shimmer_2s_infinite]" />
            
            {/* Segments for visual effect */}
            <div className="absolute inset-0 flex">
              {[...Array(20)].map((_, i) => (
                <div key={i} className="flex-1 border-r border-black/10" />
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
