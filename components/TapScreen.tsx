'use client';
import React, { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { gameState } from '@/lib/gameState'; // تأكد من المسار

export function TapScreen() {
  const [coins, setCoins] = useState(gameState.getDisplayState().coins);
  const [energy, setEnergy] = useState(gameState.getDisplayState().energy);
  const [displayNumbers, setDisplayNumbers] = useState<{id: number, x: number, y: number, v: number}[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(0);

  // تحديث العملات والطاقة في الواجهة فقط عند النقر
  const handleTap = (e: React.TouchEvent | React.MouseEvent) => {
    const touches = 'touches' in e ? Array.from(e.touches).slice(0, 3) : [{ clientX: (e as any).clientX, clientY: (e as any).clientY }];
    
    touches.forEach(touch => {
      const res = gameState.addTap();
      if (!res.success) return;

      setCoins(prev => prev + res.earned);
      setEnergy(prev => prev - 1);

      // إضافة الرقم الطائر (الحد الأقصى 5 لتجنب اللاج)
      const rect = containerRef.current?.getBoundingClientRect();
      const newNum = { id: nextId.current++, x: touch.clientX - (rect?.left || 0), y: touch.clientY - (rect?.top || 0), v: res.earned };
      
      setDisplayNumbers(prev => [...prev.slice(-4), newNum]);
      setTimeout(() => setDisplayNumbers(prev => prev.filter(n => n.id !== newNum.id)), 600);
    });
  };

  return (
    <div ref={containerRef} className="relative h-full w-full flex flex-col items-center justify-center touch-none select-none overflow-hidden" onTouchStart={handleTap}>
      <div className="text-5xl font-black mb-8 text-white">{Math.floor(coins).toLocaleString()}</div>
      
      <motion.div whileTap={{ scale: 0.9 }} className="w-64 h-64 rounded-full bg-gradient-to-br from-yellow-400 to-amber-600 flex items-center justify-center shadow-2xl border-8 border-yellow-500/50">
        <span className="text-9xl font-black text-white">H</span>
      </motion.div>

      <div className="mt-10 w-64 h-4 bg-gray-800 rounded-full overflow-hidden">
        <div className="h-full bg-yellow-500 transition-all duration-100" style={{ width: `${(energy/500)*100}%` }} />
      </div>

      <AnimatePresence>
        {displayNumbers.map(n => (
          <motion.div key={n.id} initial={{ opacity: 1, y: n.y }} animate={{ opacity: 0, y: n.y - 120 }} exit={{ opacity: 0 }} className="absolute text-3xl font-bold text-yellow-400 pointer-events-none" style={{ left: n.x }}>
            +{n.v}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
