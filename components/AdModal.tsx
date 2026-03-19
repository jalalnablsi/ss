'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { PlayCircle, Loader2 } from 'lucide-react';

interface AdModalProps {
  isOpen: boolean;
  title: string;
  description: string;
  onComplete: (success: boolean) => void;
}

export function AdModal({ isOpen, title, description, onComplete }: AdModalProps) {
  const [timeLeft, setTimeLeft] = useState(5);
  const [isWatching, setIsWatching] = useState(false);

  const canClaim = isWatching && timeLeft === 0;

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isWatching && timeLeft > 0) {
      timer = setTimeout(() => setTimeLeft(prev => prev - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [isWatching, timeLeft]);

  const handleStartAd = () => {
    setIsWatching(true);
  };

  const handleClaim = () => {
    onComplete(true);
    setIsWatching(false);
    setTimeLeft(5);
  };

  const handleCancel = () => {
    onComplete(false);
    setIsWatching(false);
    setTimeLeft(5);
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4"
      >
        <motion.div
          initial={{ scale: 0.9, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.9, y: 20 }}
          className="bg-[#111] border border-white/10 rounded-3xl p-6 w-full max-w-sm shadow-2xl relative overflow-hidden"
        >
          <div className="absolute -top-20 -right-20 w-40 h-40 bg-blue-500/20 blur-3xl rounded-full pointer-events-none" />
          
          {!isWatching ? (
            <div className="text-center space-y-4 relative z-10">
              <div className="w-16 h-16 bg-blue-500/10 text-blue-400 rounded-full flex items-center justify-center mx-auto mb-4 border border-blue-500/20">
                <PlayCircle size={32} />
              </div>
              <h3 className="text-xl font-bold text-white">{title}</h3>
              <p className="text-zinc-400 text-sm leading-relaxed">{description}</p>
              
              <div className="pt-6 flex gap-3">
                <button
                  onClick={handleCancel}
                  className="flex-1 py-3.5 rounded-2xl font-semibold text-zinc-400 bg-white/5 hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleStartAd}
                  className="flex-1 py-3.5 rounded-2xl font-semibold text-black bg-gradient-to-r from-blue-400 to-indigo-500 hover:opacity-90 transition-opacity shadow-[0_0_20px_rgba(59,130,246,0.3)]"
                >
                  Watch Ad
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center space-y-6 py-4 relative z-10">
              <h3 className="text-lg font-bold text-white">
                {canClaim ? 'Ad Completed!' : 'Watching Ad...'}
              </h3>
              
              <div className="relative w-24 h-24 mx-auto flex items-center justify-center">
                {!canClaim ? (
                  <>
                    <Loader2 size={48} className="text-blue-500 animate-spin" />
                    <span className="absolute text-xl font-bold">{timeLeft}</span>
                  </>
                ) : (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="w-20 h-20 bg-green-500/20 text-green-400 rounded-full flex items-center justify-center border border-green-500/30"
                  >
                    <span className="text-3xl">🎉</span>
                  </motion.div>
                )}
              </div>

              <p className="text-zinc-400 text-sm">
                {canClaim ? 'Thank you! You can now claim your reward.' : 'Please wait until the ad finishes to get your reward.'}
              </p>

              <button
                onClick={handleClaim}
                disabled={!canClaim}
                className={`w-full py-3.5 rounded-2xl font-bold transition-all duration-300 ${
                  canClaim 
                    ? 'bg-gradient-to-r from-green-400 to-emerald-500 text-black shadow-[0_0_20px_rgba(52,211,153,0.4)] hover:scale-[1.02]' 
                    : 'bg-white/5 text-zinc-500 cursor-not-allowed'
                }`}
              >
                {canClaim ? 'Claim Reward' : `Wait ${timeLeft}s`}
              </button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
