// components/FriendsScreen.tsx
'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useGame } from './GameProvider';
import { Users, Copy, Check, Trophy, Lock, UserPlus, Coins } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export function FriendsScreen() {
  const { coins } = useGame();
  const [refData, setRefData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [myId, setMyId] = useState<string>('');

  useEffect(() => {
    const userId = (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.id;
    if (userId) setMyId(userId.toString());
  }, []);

  const fetchReferrals = useCallback(async () => {
    const initData = (window as any).Telegram?.WebApp?.initData;
    if (!initData) return;

    try {
      const res = await fetch(`/api/referrals?initData=${encodeURIComponent(initData)}`);
      if (res.ok) {
        const data = await res.json();
        setRefData(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReferrals();
  }, [fetchReferrals]);

  const getInviteLink = () => {
    if (!myId) return '';
    // تأكد من عدم وجود مسافات زائدة
    return `https://t.me/Tap_hustle_bot?start=${myId}`;
  };

  const copyLink = () => {
    const link = getInviteLink();
    if (!link) return;
    
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    
    const webApp = (window as any).Telegram?.WebApp;
    if (webApp) {
      webApp.HapticFeedback.notificationOccurred('success');
      webApp.showPopup({
        title: 'Success',
        message: 'Invitation link copied!',
        buttons: [{ type: 'ok' }]
      });
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-white">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-zinc-400 animate-pulse">Loading friends...</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-y-auto pt-6 pb-28 px-4 text-white relative">
      {/* Header Section */}
      <div className="text-center mb-8">
        <h1 className="text-3xl font-black text-white mb-2 tracking-tight">Invite Friends</h1>
        <p className="text-zinc-400 text-sm">Earn <span className="text-yellow-400 font-bold">1,500 coins</span> for every friend who reaches 500 taps!</p>
      </div>

      {/* Invite Card - Improved Design */}
      <motion.div 
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 rounded-3xl p-6 mb-8 shadow-[0_10px_40px_-10px_rgba(59,130,246,0.5)] relative overflow-hidden border border-white/10"
      >
        <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-3xl -mr-10 -mt-10" />
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-white/20 backdrop-blur-md rounded-xl flex items-center justify-center">
              <UserPlus size={20} className="text-white" />
            </div>
            <h2 className="text-lg font-bold text-white">Friend Bonus</h2>
          </div>
          
          <p className="text-blue-100 text-sm mb-6 leading-relaxed">
            Share your unique link. When your friend taps 500 times, you both get rewarded!
          </p>
          
          <button 
            onClick={copyLink}
            className="group w-full bg-white text-blue-600 font-bold py-4 rounded-2xl flex items-center justify-center gap-2 active:scale-95 transition-all shadow-lg hover:shadow-xl hover:bg-blue-50"
          >
            {copied ? <Check size={20} className="text-green-600" /> : <Copy size={20} />}
            <span>{copied ? 'Copied to Clipboard!' : 'Copy Invitation Link'}</span>
          </button>
        </div>
      </motion.div>

      {/* Stats Grid */}
      {refData?.myStats && (
        <div className="grid grid-cols-2 gap-4 mb-8">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="bg-zinc-900/80 backdrop-blur-md border border-zinc-800 rounded-2xl p-4 text-center relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent" />
            <div className="relative z-10">
              <div className="flex items-center justify-center gap-2 text-zinc-400 text-xs mb-2 font-medium uppercase tracking-wider">
                <Users size={14} /> Total Friends
              </div>
              <div className="text-3xl font-black text-white">{refData.myStats.totalReferrals || 0}</div>
            </div>
          </motion.div>
          
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="bg-zinc-900/80 backdrop-blur-md border border-zinc-800 rounded-2xl p-4 text-center relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-yellow-500/5 to-transparent" />
            <div className="relative z-10">
              <div className="flex items-center justify-center gap-2 text-zinc-400 text-xs mb-2 font-medium uppercase tracking-wider">
                <Coins size={14} /> Earned
              </div>
              <div className="text-3xl font-black text-yellow-400">{refData.myStats.earnedCoins || 0}</div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Referrals List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-zinc-300">Your Squad</h3>
          <span className="text-xs text-zinc-500 bg-zinc-900 px-2 py-1 rounded-lg">
            {refData?.referrals?.length || 0} Members
          </span>
        </div>
        
        {(!refData?.referrals || refData.referrals.length === 0) ? (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-12 text-zinc-500 bg-zinc-900/30 rounded-3xl border border-zinc-800 border-dashed"
          >
            <div className="w-16 h-16 bg-zinc-800/50 rounded-full flex items-center justify-center mx-auto mb-4">
              <Users size={32} className="opacity-50" />
            </div>
            <p className="font-medium">No friends invited yet.</p>
            <p className="text-sm mt-1 opacity-70">Be the first to build your team!</p>
          </motion.div>
        ) : (
          <AnimatePresence>
            {refData.referrals.map((friend: any, index: number) => {
              const progress = Math.min(100, (friend.taps / 500) * 100);
              const isReady = friend.taps >= 500;
              
              return (
                <motion.div 
                  key={friend.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ delay: index * 0.05 }}
                  className="bg-zinc-900/80 backdrop-blur-md border border-zinc-800 rounded-2xl p-4 flex flex-col gap-3 hover:border-zinc-700 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-12 h-12 rounded-full flex items-center justify-center font-black text-lg shadow-inner ${
                        isReady 
                          ? 'bg-gradient-to-br from-yellow-400 to-orange-500 text-black shadow-[0_0_15px_rgba(251,191,36,0.3)]' 
                          : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                      }`}>
                        {friend.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-bold text-white text-base">{friend.name}</div>
                        <div className="text-xs text-zinc-500 font-medium">
                          {friend.taps.toLocaleString()} taps • {friend.coins.toLocaleString()} coins
                        </div>
                      </div>
                    </div>
                    
                    <div>
                      {isReady ? (
                        <div className="flex items-center gap-1.5 text-yellow-400 bg-yellow-500/10 px-3 py-1.5 rounded-xl border border-yellow-500/20">
                          <Trophy size={16} />
                          <span className="text-xs font-bold">Claimed</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-zinc-400 bg-zinc-800 px-3 py-1.5 rounded-xl border border-zinc-700">
                          <Lock size={14} />
                          <span className="text-xs font-bold">{Math.max(0, 500 - friend.taps)} left</span>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {/* Progress Bar */}
                  {!isReady && (
                    <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${progress}%` }}
                        transition={{ duration: 1, ease: "easeOut" }}
                        className={`h-full rounded-full ${
                          progress > 80 ? 'bg-gradient-to-r from-green-400 to-emerald-500' : 
                          progress > 50 ? 'bg-gradient-to-r from-blue-400 to-indigo-500' : 
                          'bg-gradient-to-r from-zinc-600 to-zinc-500'
                        }`}
                      />
                    </div>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
