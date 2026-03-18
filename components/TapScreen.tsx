'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { gameState } from '@/lib/gameState';
import { Zap, Bot, Sparkles, Gauge } from 'lucide-react';

interface Particle {
  id: number;
  x: number;
  y: number;
  value: number;
  color: string;
}

export function TapScreen() {
  // حالة العرض
  const [coins, setCoins] = useState(0);
  const [energy, setEnergy] = useState(500);
  const [maxEnergy, setMaxEnergy] = useState(500);
  const [multiplier, setMultiplier] = useState(1);
  const [multiplierEndTime, setMultiplierEndTime] = useState(0);
  const [botActiveUntil, setBotActiveUntil] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingTaps, setPendingTaps] = useState(0);
  
  // البارتكلات
  const [particles, setParticles] = useState<Particle[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const particleIdRef = useRef(0);
  const lastTapTimeRef = useRef(0);

  // الاشتراك في تحديثات gameState
  useEffect(() => {
    const unsubscribe = gameState.subscribe(() => {
      const state = gameState.getDisplayState();
      setCoins(state.coins);
      setEnergy(state.energy);
      setMaxEnergy(state.maxEnergy);
      setMultiplier(state.multiplier);
      setMultiplierEndTime(state.multiplierEndTime);
      setBotActiveUntil(state.botActiveUntil);
      setIsSyncing(state.isSyncing);
      setPendingTaps(state.pendingTaps);
    });

    return unsubscribe;
  }, []);

  // تحميل البيانات الأولية
  useEffect(() => {
    const init = async () => {
      try {
        const response = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            initData: window.Telegram?.WebApp?.initData 
          })
        });

        if (response.ok) {
          const data = await response.json();
          gameState.setServerState({
            coins: data.user.coins,
            energy: data.user.energy,
            maxEnergy: data.user.max_energy,
            multiplier: data.user.tap_multiplier,
            multiplierEndTime: data.user.tap_multiplier_end_time,
            botActiveUntil: data.user.auto_bot_active_until
          });
        }
      } catch (e) {
        console.error('Init failed:', e);
      }
    };

    init();

    // تفعيل البوت إذا كان نشط
    const botInterval = setInterval(() => {
      const now = Date.now();
      if (botActiveUntil > now) {
        gameState.addBotTaps(1); // البوت يضغط مرة كل ثانية
      }
    }, 1000);

    return () => {
      clearInterval(botInterval);
    };
  }, []);

  // معالج اللمس
  const handleTap = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    
    const now = Date.now();
    // منع الضغط السريع جداً (أقل من 50ms)
    if (now - lastTapTimeRef.current < 50) return;
    lastTapTimeRef.current = now;

    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    
    // دعم اللمسات المتعددة (Multi-touch)
    const touches = 'touches' in e 
      ? Array.from(e.touches).slice(0, 3) // 3 أصابع كحد أقصى
      : [{ clientX: (e as React.MouseEvent).clientX, clientY: (e as React.MouseEvent).clientY }];

    touches.forEach(touch => {
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;

      // التأكد من أن اللمسة داخل المنطقة
      if (x < 0 || x > rect.width || y < 0 || y > rect.height) return;

      // إضافة الضغطة
      const result = gameState.addTap();
      
      if (result.success) {
        // إضافة بارتكل
        const colors = ['#facc15', '#fbbf24', '#f59e0b', '#f97316'];
        const color = colors[Math.floor(Math.random() * colors.length)];
        
        setParticles(prev => [...prev, {
          id: particleIdRef.current++,
          x, y,
          value: result.earned,
          color
        }]);

        // حذف البارتكل بعد ثانية
        setTimeout(() => {
          setParticles(prev => prev.filter(p => p.id !== particleIdRef.current - 1));
        }, 800);

        // هزاز خفيف
        window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.('light');
      }
    });
  }, []);

  // حساب الوقت المتبقي للمضاعف
  const multiplierTimeLeft = multiplierEndTime > Date.now()
    ? Math.ceil((multiplierEndTime - Date.now()) / 1000)
    : 0;

  const energyPercent = (energy / maxEnergy) * 100;
  const isMultiplierActive = multiplierEndTime > Date.now();
  const isBotActive = botActiveUntil > Date.now();

  return (
    <div 
      ref={containerRef}
      className="relative flex flex-col items-center justify-between h-full w-full pt-4 pb-28 px-4 overflow-hidden select-none touch-none"
      onTouchStart={handleTap}
      onMouseDown={handleTap}
    >
      {/* خلفية متحركة */}
      <div className="absolute inset-0 bg-gradient-to-b from-yellow-500/5 via-transparent to-transparent pointer-events-none" />
      
      {/* البارتكلات العائمة */}
      <AnimatePresence>
        {particles.map(p => (
          <motion.div
            key={p.id}
            initial={{ opacity: 1, scale: 0.5, x: p.x, y: p.y }}
            animate={{ 
              opacity: 0, 
              scale: 1.5, 
              y: p.y - 100,
              x: p.x + (Math.random() - 0.5) * 40
            }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8 }}
            className="absolute pointer-events-none z-50 text-2xl font-black drop-shadow-lg"
            style={{ color: p.color, left: 0, top: 0 }}
          >
            +{p.value}
          </motion.div>
        ))}
      </AnimatePresence>

      {/* الشريط العلوي */}
      <div className="w-full flex justify-between items-start z-10">
        <div className="flex gap-2">
          {isMultiplierActive && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="bg-gradient-to-r from-yellow-500/20 to-orange-500/20 backdrop-blur-xl border border-yellow-500/30 rounded-xl px-3 py-1.5 flex items-center gap-2"
            >
              <Zap size={16} className="text-yellow-400 fill-yellow-400" />
              <span className="text-yellow-400 font-bold">{multiplier}x</span>
              <span className="text-yellow-400/70 text-xs">{multiplierTimeLeft}s</span>
            </motion.div>
          )}

          {isBotActive && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="bg-gradient-to-r from-blue-500/20 to-cyan-500/20 backdrop-blur-xl border border-blue-500/30 rounded-xl px-3 py-1.5 flex items-center gap-2"
            >
              <Bot size={16} className="text-blue-400" />
              <span className="text-blue-400 font-bold">Auto</span>
            </motion.div>
          )}
        </div>

        {isSyncing && (
          <div className="bg-black/40 backdrop-blur-xl rounded-full px-3 py-1.5 flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-zinc-300">Saving</span>
          </div>
        )}
      </div>

      {/* العداد الرئيسي */}
      <div className="flex flex-col items-center z-10 mt-8">
        <span className="text-zinc-400 text-xs font-medium uppercase tracking-widest mb-1">
          Your Balance
        </span>
        
        <div className="relative">
          <motion.h1 
            key={coins}
            initial={{ scale: 1 }}
            animate={{ scale: [1, 1.05, 1] }}
            transition={{ duration: 0.2 }}
            className="text-7xl font-black text-white drop-shadow-[0_0_30px_rgba(250,204,21,0.3)] tabular-nums"
          >
            {Math.floor(coins).toLocaleString()}
          </motion.h1>

          {pendingTaps > 0 && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="absolute -top-2 -right-8 bg-yellow-500 text-black text-xs font-bold px-2 py-1 rounded-full"
            >
              +{pendingTaps}
            </motion.div>
          )}
        </div>
      </div>

      {/* زر الضغط */}
      <div className="relative flex-1 flex items-center justify-center my-4">
        <motion.div
          whileTap={{ scale: 0.9 }}
          transition={{ type: "spring", stiffness: 400, damping: 15 }}
          className="relative w-64 h-64 md:w-72 md:h-72 cursor-pointer"
        >
          {/* التوهج */}
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-yellow-400/30 via-yellow-500/30 to-amber-600/30 blur-3xl animate-pulse" />
          
          {/* الزر الرئيسي */}
          <div className="relative w-full h-full rounded-full bg-gradient-to-br from-yellow-400 via-yellow-500 to-amber-600 p-1 shadow-[0_20px_40px_rgba(0,0,0,0.4),inset_0_2px_10px_rgba(255,255,255,0.6)]">
            <div className="w-full h-full rounded-full bg-gradient-to-br from-yellow-300 to-amber-500 flex items-center justify-center shadow-inner">
              <span className="text-8xl font-black text-white drop-shadow-lg select-none">
                💎
              </span>
            </div>
          </div>

          {/* دائرة المضاعف */}
          {isMultiplierActive && (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
              className="absolute inset-0 rounded-full border-2 border-yellow-400 border-t-transparent"
            />
          )}
        </motion.div>
      </div>

      {/* شريط الطاقة */}
      <div className="w-full max-w-sm px-4 z-10 mb-4">
        <div className="flex justify-between items-center mb-2">
          <div className="flex items-center gap-2">
            <Zap size={18} className="text-yellow-400 fill-yellow-400" />
            <span className="text-sm font-medium text-zinc-300">Energy</span>
          </div>
          <span className="text-sm font-bold text-white tabular-nums">
            {Math.floor(energy)} / {maxEnergy}
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
            animate={{ width: `${energyPercent}%` }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          >
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent -translate-x-full animate-[shimmer_2s_infinite]" />
          </motion.div>
        </div>
      </div>
    </div>
  );
}
