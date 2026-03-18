'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useGame } from './GameProvider';
import { Zap, Bot, ShieldAlert, Sparkles } from 'lucide-react';

// تعريف نوع الرقم العائم
interface FloatingNumber {
  id: number;
  x: number;
  y: number;
  value: number;
}

export function TapScreen() {
  const { coins, energy, maxEnergy, tap, tapMultiplier, tapMultiplierEndTime, autoBotActiveUntil } = useGame();
  
  // نحتفظ بالأرقام في Ref أولاً لتجنب التحديث المباشر ثم ننقلها للـ State للعرض فقط
  const floatingNumbersRef = useRef<FloatingNumber[]>([]);
  const [displayNumbers, setDisplayNumbers] = useState<FloatingNumber[]>([]);
  const numberIdRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // دالة تنظيف الأرقام القديمة تلقائياً
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      // نحتفظ بالأرقام التي عمرها أقل من 800ms فقط
      // هذه الطريقة أخف من استخدام setTimeout لكل رقم
      // لكن للتبسيط مع Motion، سنعتمد على الفلترة في الإضافة
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleTap = useCallback((e: React.TouchEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>) => {
    if (e.type === 'touchstart') {
      e.preventDefault(); // منع التكبير والتمرير
    }

    if ('touches' in e) {
      // دعم اللمس المتعدد
      Array.from(e.changedTouches).forEach(touch => {
        processTap(touch.clientX, touch.clientY);
      });
    } else {
      // دعم الماوس
      processTap((e as React.MouseEvent).clientX, (e as React.MouseEvent).clientY);
    }
  }, [tap, tapMultiplier, tapMultiplierEndTime]);

  const processTap = (clientX: number, clientY: number) => {
    const success = tap(1);
    if (!success) return; 

    // حساب الموقع النسبي بدقة
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

    // 🔥 التحسين الجوهري: إضافة الرقم ثم قص القائمة فوراً إذا زادت عن 6
    // هذا يمنع تراكم مئات العناصر في الـ DOM ويسبب اللاج
    floatingNumbersRef.current.push(newNumber);
    
    // نحتفظ بآخر 6 أرقام فقط
    if (floatingNumbersRef.current.length > 6) {
      floatingNumbersRef.current.shift(); // حذف الأقدم
    }

    // تحديث الـ State للعرض (سيؤدي إلى re-render خفيف جداً)
    setDisplayNumbers([...floatingNumbersRef.current]);

    // جدولة الحذف بعد انتهاء الأنيميشن
    setTimeout(() => {
      floatingNumbersRef.current = floatingNumbersRef.current.filter(n => n.id !== newNumber.id);
      setDisplayNumbers([...floatingNumbersRef.current]);
    }, 800); // نفس مدة الأنيميشن
  };

  const formatCoins = (num: number) => Math.floor(num).toLocaleString('en-US');

  const isMultiplierActive = tapMultiplierEndTime > Date.now();
  const isBotActive = autoBotActiveUntil > Date.now();

  return (
    <div className="flex flex-col items-center justify-between h-full w-full pt-4 pb-28 px-4 relative overflow-hidden select-none">
      
      {/* خلفية جمالية خفيفة (بدون أنيميشن ثقيل) */}
      <div className="absolute top-[-10%] left-[-10%] w-[120%] h-[120%] bg-[radial-gradient(circle_at_50%_40%,_rgba(250,204,21,0.05)_0%,_transparent_60%)] pointer-events-none" />
      
      {/* الشريط العلوي للإعلان (ثابت) */}
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

      {/* منطقة الإحصائيات */}
      <div className="w-full flex flex-col items-center space-y-4 z-10 mt-4">
        
        {/* حالة المكافآت النشطة */}
        <div className="flex gap-2 h-8">
          <AnimatePresence>
            {isMultiplierActive && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="bg-orange-500/10 border border-orange-500/30 text-orange-400 px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 shadow-[0_0_15px_rgba(249,115,22,0.15)] backdrop-blur-md"
              >
                <Zap size={14} />
                <span>x{tapMultiplier}</span>
              </motion.div>
            )}
            {isBotActive && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="bg-blue-500/10 border border-blue-500/30 text-blue-400 px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 shadow-[0_0_15px_rgba(59,130,246,0.15)] backdrop-blur-md"
              >
                <Bot size={14} />
                <span>Bot Active</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* رصيد العملات */}
        <div className="flex flex-col items-center justify-center gap-1">
          <span className="text-zinc-400 text-xs font-medium uppercase tracking-widest">Total Balance</span>
          <h1 className="text-5xl font-black text-white drop-shadow-2xl tabular-nums tracking-tight">
            {formatCoins(coins)}
          </h1>
        </div>
      </div>

      {/* منطقة اللمس الرئيسية */}
      <div 
        ref={containerRef}
        className="relative flex-1 w-full flex items-center justify-center touch-none my-4"
        onTouchStart={handleTap}
        onMouseDown={handleTap}
      >
        {/* العملة الرئيسية */}
        <motion.div
          whileTap={{ scale: 0.95 }} // أنيميشن بسيط جداً عند الضغط
          transition={{ type: "spring", stiffness: 400, damping: 15 }}
          className="relative z-10 w-64 h-64 md:w-72 md:h-72 rounded-full cursor-pointer perspective-1000"
          style={{ willChange: 'transform' }} // تحسين الأداء
        >
          {/* توهج خارجي ثابت */}
          <div className="absolute inset-0 rounded-full bg-yellow-500/20 blur-3xl" />
          
          {/* جسم العملة */}
          <div className="w-full h-full rounded-full bg-gradient-to-br from-yellow-300 via-yellow-500 to-amber-700 p-1 shadow-[0_10px_40px_rgba(217,119,6,0.4),inset_0_4px_10px_rgba(255,255,255,0.4)] relative overflow-hidden flex items-center justify-center">
            <div className="w-[90%] h-[90%] rounded-full border-4 border-yellow-200/30 bg-gradient-to-br from-yellow-400 to-amber-600 flex items-center justify-center shadow-[inset_0_0_20px_rgba(0,0,0,0.2)]">
              <span className="text-7xl md:text-8xl font-black text-yellow-100 drop-shadow-[0_4px_4px_rgba(0,0,0,0.3)]">
                T
              </span>
            </div>
            {/* لمعة بسيطة */}
            <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/20 to-transparent -rotate-45 translate-x-[-100%] animate-[shimmer_3s_infinite]" />
          </div>
        </motion.div>

        {/* الأرقام الطائرة (محسنة للأداء) */}
        <AnimatePresence>
          {displayNumbers.map(num => (
            <motion.div
              key={num.id}
              initial={{ opacity: 1, y: num.y - 40, x: num.x - 20, scale: 0.8 }}
              animate={{ opacity: 0, y: num.y - 140, scale: 1.2 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.7, ease: "easeOut" }}
              className="absolute z-50 text-4xl font-black text-white pointer-events-none drop-shadow-[0_2px_2px_rgba(0,0,0,0.5)]"
              style={{ 
                left: 0, 
                top: 0,
                willChange: 'transform, opacity' // إجبار المتصفح على استخدام GPU
              }}
            >
              +{num.value}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* شريط الطاقة */}
      <div className="w-full max-w-sm px-4 z-10 space-y-2 mb-2">
        <div className="flex justify-between items-end">
          <div className="flex items-center gap-1.5">
            <Zap size={18} className="text-yellow-400 fill-yellow-400" />
            <span className="text-base font-bold text-white tabular-nums">{Math.floor(energy)} <span className="text-zinc-500 text-xs">/ {maxEnergy}</span></span>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-zinc-500 font-medium bg-white/5 px-2 py-1 rounded-md border border-white/5">
            <ShieldAlert size={12} />
            <span>Secure</span>
          </div>
        </div>
        
        {/* شريط التقدم */}
        <div className="h-5 w-full bg-[#111] rounded-full overflow-hidden border border-white/10 p-0.5 shadow-inner relative">
          <motion.div 
            className="h-full bg-gradient-to-r from-yellow-600 via-yellow-400 to-yellow-300 rounded-full relative overflow-hidden"
            initial={{ width: `${(energy / maxEnergy) * 100}%` }}
            animate={{ width: `${(energy / maxEnergy) * 100}%` }}
            transition={{ type: 'tween', ease: 'linear', duration: 0.3 }} // تحديث أسرع للطاقة
            style={{ willChange: 'width' }}
          >
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent -translate-x-full animate-[shimmer_2s_infinite]" />
          </motion.div>
        </div>
      </div>
    </div>
  );
}
