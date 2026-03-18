'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Zap, Battery, Bot, Gift, Sparkles } from 'lucide-react';

interface AdModalProps {
  isOpen: boolean;
  type: 'multiplier' | 'energy' | 'bot';
  onClose: () => void;
  onWatch: () => Promise<void>;
  isWatching: boolean;
}

const adConfig = {
  multiplier: {
    title: '⚡ DOUBLE STRIKE',
    description: 'Get 2x coins for 5 minutes!',
    icon: Zap,
    color: 'from-orange-500 to-yellow-500',
    reward: '2x Multiplier • 5 Minutes',
    coins: '+1000'
  },
  energy: {
    title: '🔋 FULL ENERGY',
    description: 'Instantly refill your energy!',
    icon: Battery,
    color: 'from-green-500 to-emerald-500',
    reward: 'Full Energy Refill',
    coins: '+1000'
  },
  bot: {
    title: '🤖 AUTO BOT',
    description: 'Auto-tap for 6 hours!',
    icon: Bot,
    color: 'from-blue-500 to-cyan-500',
    reward: 'Auto Bot • 6 Hours',
    coins: '+1000'
  }
};

export function AdModal({ isOpen, type, onClose, onWatch, isWatching }: AdModalProps) {
  const config = adConfig[type];

  if (!config) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 20 }}
            className="relative w-full max-w-sm bg-gradient-to-b from-zinc-900 to-black rounded-3xl border border-white/10 overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close Button */}
            <button
              onClick={onClose}
              className="absolute top-4 right-4 z-10 p-2 bg-black/50 rounded-full hover:bg-black/70 transition-colors"
            >
              <X size={20} className="text-zinc-400" />
            </button>

            {/* Header */}
            <div className={`relative h-48 bg-gradient-to-br ${config.color} p-6 flex items-center justify-center overflow-hidden`}>
              <div className="absolute inset-0 bg-black/20" />
              <div className="absolute -top-10 -right-10 w-32 h-32 bg-white/20 rounded-full blur-3xl" />
              <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-white/20 rounded-full blur-3xl" />
              
              <div className="relative text-center">
                <motion.div
                  animate={{ 
                    rotate: [0, 10, -10, 0],
                    scale: [1, 1.1, 1]
                  }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="w-20 h-20 mx-auto mb-2 bg-white/20 backdrop-blur-xl rounded-2xl flex items-center justify-center"
                >
                  <config.icon size={40} className="text-white" />
                </motion.div>
                <h2 className="text-2xl font-black text-white">{config.title}</h2>
                <p className="text-white/80 text-sm">{config.description}</p>
              </div>
            </div>

            {/* Body */}
            <div className="p-6 space-y-6">
              {/* Rewards */}
              <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 bg-yellow-500/20 rounded-xl">
                    <Gift size={20} className="text-yellow-400" />
                  </div>
                  <span className="text-sm font-medium text-zinc-300">You will receive:</span>
                </div>
                
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-400">Watch Reward:</span>
                    <span className="text-yellow-400 font-bold">{config.coins} Coins</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-400">Bonus:</span>
                    <span className="text-white font-bold">{config.reward}</span>
                  </div>
                </div>

                {/* Ad Info */}
                <div className="mt-4 pt-4 border-t border-white/10 flex items-center gap-2 text-xs text-zinc-500">
                  <Sparkles size={14} />
                  <span>30-second video ad • No download required</span>
                </div>
              </div>

              {/* Watch Button */}
              <button
                onClick={onWatch}
                disabled={isWatching}
                className={`w-full py-4 rounded-xl font-bold text-lg relative overflow-hidden group
                  ${isWatching 
                    ? 'bg-zinc-700 text-zinc-400 cursor-not-allowed' 
                    : `bg-gradient-to-r ${config.color} text-white hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all`
                  }`}
              >
                {isWatching ? (
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Loading Ad...</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-2">
                    <span>▶</span>
                    <span>Watch Ad & Claim</span>
                  </div>
                )}

                {/* Shine Effect */}
                {!isWatching && (
                  <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                )}
              </button>

              {/* Terms */}
              <p className="text-center text-xs text-zinc-600">
                By watching you agree to our Terms of Service
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
