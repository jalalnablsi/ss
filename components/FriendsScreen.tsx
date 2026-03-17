'use client';

import React, { useEffect, useState } from 'react';
import { useGame } from './GameProvider';
import { Users, Copy, Check, Trophy, Lock } from 'lucide-react';
import { motion } from 'motion/react';

export function FriendsScreen() {
  const { coins } = useGame();
  const [refData, setRefData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const fetchReferrals = async () => {
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
    };

    fetchReferrals();
  }, []);

  const getInviteLink = () => {
    const userId = (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.id;
    if (!userId) return '';
    // تم تحديث الرابط ليتوافق مع اسم البوت الخاص بك
    return `https://t.me/Tap_hustle_bot?start=${userId}`;
  };

  const copyLink = () => {
    const link = getInviteLink();
    if (!link) return;
    
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    
    // --- التعديل هنا لحل خطأ الـ Build ---
    const webApp = (window as any).Telegram?.WebApp;
    if (webApp && typeof webApp.showPopup === 'function') {
      webApp.showPopup({
        title: 'Invitation Link',
        message: 'Link copied to clipboard!',
        buttons: [{ type: 'ok' }]
      });
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full text-white">Loading...</div>;
  }

  return (
    <div className="h-full w-full overflow-y-auto pt-4 pb-28 px-4 text-white">
      <h1 className="text-2xl font-bold mb-6 text-center">Invite Friends</h1>

      {/* Invite Card */}
      <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl p-6 mb-6 shadow-lg relative overflow-hidden">
        <div className="relative z-10">
          <h2 className="text-xl font-bold mb-2">Get 1,500 Coins per Friend!</h2>
          <p className="text-blue-100 text-sm mb-4">Invite friends and earn when they reach 500 taps.</p>
          
          <button 
            onClick={copyLink}
            className="w-full bg-white text-blue-600 font-bold py-3 rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-transform"
          >
            {copied ? <Check size={20} /> : <Copy size={20} />}
            {copied ? 'Copied!' : 'Copy Invite Link'}
          </button>
        </div>
        <div className="absolute -top-10 -right-10 w-32 h-32 bg-white/10 rounded-full blur-2xl" />
        <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-black/10 rounded-full blur-2xl" />
      </div>

      {/* Stats Grid */}
      {refData?.myStats && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-center">
            <div className="text-zinc-400 text-xs mb-1">Total Friends</div>
            <div className="text-2xl font-bold text-white">{refData.myStats.totalReferrals}</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-center">
            <div className="text-zinc-400 text-xs mb-1">Earned Coins</div>
            <div className="text-2xl font-bold text-yellow-400">{refData.myStats.earnedCoins}</div>
          </div>
        </div>
      )}

      {/* Referrals List */}
      <div className="space-y-3">
        <h3 className="text-lg font-bold text-zinc-400">Your Friends</h3>
        
        {(!refData?.referrals || refData.referrals.length === 0) ? (
          <div className="text-center py-10 text-zinc-500 bg-zinc-900/50 rounded-xl border border-zinc-800 border-dashed">
            <Users size={48} className="mx-auto mb-3 opacity-50" />
            <p>No friends invited yet.</p>
            <p className="text-sm mt-1">Be the first to invite!</p>
          </div>
        ) : (
          refData.referrals.map((friend: any) => (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              key={friend.id} 
              className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${friend.rewardClaimed ? 'bg-yellow-500/20 text-yellow-500' : 'bg-zinc-800 text-zinc-400'}`}>
                  {friend.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="font-bold text-white">{friend.name}</div>
                  <div className="text-xs text-zinc-500">
                    {friend.taps} taps • {friend.coins} coins
                  </div>
                </div>
              </div>
              
              <div>
                {friend.rewardClaimed ? (
                  <div className="flex items-center gap-1 text-yellow-500 text-xs font-bold bg-yellow-500/10 px-2 py-1 rounded-lg">
                    <Trophy size={12} />
                    <span>+1500</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 text-zinc-600 text-xs font-bold bg-zinc-800 px-2 py-1 rounded-lg">
                    <Lock size={12} />
                    <span>{500 - friend.taps > 0 ? `${500 - friend.taps} left` : 'Pending'}</span>
                  </div>
                )}
              </div>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}
