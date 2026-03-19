'use client';

import React, { useState, useEffect } from 'react';
import { useGame } from './GameProvider';
import { Users, Copy, CheckCircle2, Gift, Share2, MessageCircle, Send } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export function FriendsScreen() {
  const { referralsCount, referralsActivated, referralCoinsEarned } = useGame();
  const [copied, setCopied] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initUser = () => {
      try {
        if (typeof window !== 'undefined') {
          const tg = window.Telegram?.WebApp;
          
          if (!tg) {
            setError('Please open this app from Telegram');
            setIsLoading(false);
            return;
          }

          const user = tg.initDataUnsafe?.user as TelegramUser | undefined;
          
          if (!user?.id) {
            setError('User data not found');
            setIsLoading(false);
            return;
          }

          setCurrentUserId(user.id.toString());
          setIsLoading(false);
        }
      } catch (err) {
        setError('Error loading user data');
        setIsLoading(false);
      }
    };

    initUser();
  }, []);

  const inviteLink = currentUserId 
    ? `https://t.me/Tap_hustle_bot/startapp?startapp=${currentUserId}`
    : '';

  const shareText = `Join me on Tap Hustle and earn coins! 🚀`;

  const handleCopy = async () => {
    if (!inviteLink) return;
    
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // ✅ إصلاح: زر المشاركة يعمل دائماً
  const handleShare = async () => {
    if (!inviteLink) return;

    // محاولة استخدام Web Share API أولاً
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Join me on Tap Hustle!',
          text: shareText,
          url: inviteLink,
        });
        return; // نجاح المشاركة، نخرج من الدالة
      } catch (err) {
        // إذا ألغى المستخدم أو فشلت المشاركة، نكمل للطريقة البديلة
        if ((err as Error).name === 'AbortError') {
          return; // المستخدم ألغى المشاركة
        }
        console.log('Web Share API failed, trying fallback');
      }
    }

    // ✅ الطريقة البديلة: فتح Telegram share مباشرة
    shareToTelegram();
  };

  const shareToTelegram = () => {
    if (!inviteLink) return;
    const url = `https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent(shareText)}`;
    window.open(url, '_blank');
  };

  const shareToWhatsApp = () => {
    if (!inviteLink) return;
    const url = `https://wa.me/?text=${encodeURIComponent(shareText + '\n\n' + inviteLink)}`;
    window.open(url, '_blank');
  };

  if (isLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center p-5">
        <div className="text-center">
          <div className="text-red-400 text-lg mb-2">⚠️</div>
          <div className="text-zinc-400">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full pb-28 pt-8 px-5 overflow-y-auto">
      {/* Header */}
      <div className="text-center mb-8">
        <motion.div 
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 text-indigo-400 mb-5 shadow-[0_0_30px_rgba(99,102,241,0.15)]"
        >
          <Users size={40} />
        </motion.div>
        <h2 className="text-4xl font-black text-white mb-3 tracking-tight">Friends</h2>
        <p className="text-zinc-400 text-sm">
          Invite friends and earn <span className="text-yellow-400 font-bold">1,500</span> coins for each active friend!
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-gradient-to-br from-white/10 to-white/5 border border-white/10 rounded-2xl p-4 text-center">
          <div className="text-zinc-400 text-xs font-bold uppercase tracking-wider mb-1">Total</div>
          <div className="text-2xl font-black text-white">{referralsCount}</div>
        </div>
        <div className="bg-gradient-to-br from-green-500/10 to-green-500/5 border border-green-500/20 rounded-2xl p-4 text-center">
          <div className="text-zinc-400 text-xs font-bold uppercase tracking-wider mb-1">Active</div>
          <div className="text-2xl font-black text-green-400">{referralsActivated}</div>
        </div>
        <div className="bg-gradient-to-br from-yellow-500/10 to-yellow-500/5 border border-yellow-500/20 rounded-2xl p-4 text-center">
          <div className="text-zinc-400 text-xs font-bold uppercase tracking-wider mb-1">Earned</div>
          <div className="text-2xl font-black text-yellow-400">{referralCoinsEarned.toLocaleString('en-US')}</div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="bg-white/5 border border-white/10 rounded-2xl p-4 mb-8">
        <div className="flex justify-between items-center mb-2">
          <span className="text-xs text-zinc-400">Progress to next goal</span>
          <span className="text-xs text-indigo-400 font-bold">{referralsActivated}/10</span>
        </div>
        <div className="h-2 bg-white/10 rounded-full overflow-hidden">
          <motion.div 
            initial={{ width: 0 }}
            animate={{ width: `${Math.min((referralsActivated / 10) * 100, 100)}%` }}
            transition={{ duration: 1, ease: "easeOut" }}
            className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full"
          />
        </div>
      </div>

      {/* Rules Box */}
      <div className="bg-gradient-to-br from-indigo-500/10 to-purple-500/10 border border-indigo-500/20 rounded-3xl p-5 mb-8">
        <h3 className="text-white font-bold mb-3 flex items-center gap-2">
          <Gift size={18} className="text-indigo-400" /> 
          How it works
        </h3>
        <ul className="space-y-3 text-sm text-zinc-300">
          <li className="flex items-start gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs font-bold">1</span>
            <span>Share your unique invite link with friends</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs font-bold">2</span>
            <span>Friend joins via the link and starts playing</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs font-bold">3</span>
            <span>Once they reach <strong className="text-white">500 taps</strong> they become active</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs font-bold">4</span>
            <span>You automatically earn <strong className="text-yellow-400">1,500 coins</strong>!</span>
          </li>
        </ul>
      </div>

      {/* Share Section */}
      <div className="space-y-4">
        {/* Link Display */}
        <div className="bg-black/30 border border-white/10 rounded-2xl p-4 flex items-center gap-3">
          <div className="flex-1 overflow-hidden">
            <div className="text-xs text-zinc-500 font-bold uppercase tracking-wider mb-1">Your Invite Link</div>
            <div className="text-indigo-300 text-sm truncate font-mono">
              {inviteLink || 'Loading...'}
            </div>
          </div>
          <button 
            onClick={handleCopy}
            disabled={!inviteLink}
            className="w-12 h-12 rounded-xl bg-white/10 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center transition-colors shrink-0"
          >
            {copied ? <CheckCircle2 size={20} className="text-green-400" /> : <Copy size={20} className="text-white" />}
          </button>
        </div>

        {/* ✅ إصلاح: زر المشاركة الرئيسي يعمل الآن */}
        <button 
          onClick={handleShare}
          disabled={!inviteLink}
          className="w-full py-4 rounded-2xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-500/25 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-all"
        >
          <Share2 size={20} />
          Share Link
        </button>

        {/* ✅ تعديل: عمودان فقط (Telegram و WhatsApp) */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={shareToTelegram}
            disabled={!inviteLink}
            className="py-3 rounded-xl bg-[#0088cc]/20 border border-[#0088cc]/30 text-[#0088cc] font-semibold flex flex-col items-center gap-1 hover:bg-[#0088cc]/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors active:scale-95"
          >
            <Send size={20} />
            <span className="text-xs">Telegram</span>
          </button>

          <button
            onClick={shareToWhatsApp}
            disabled={!inviteLink}
            className="py-3 rounded-xl bg-[#25d366]/20 border border-[#25d366]/30 text-[#25d366] font-semibold flex flex-col items-center gap-1 hover:bg-[#25d366]/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors active:scale-95"
          >
            <MessageCircle size={20} />
            <span className="text-xs">WhatsApp</span>
          </button>
        </div>
      </div>

      {/* Success Toast */}
      <AnimatePresence>
        {copied && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-green-500 text-white px-6 py-3 rounded-full shadow-lg flex items-center gap-2 z-50"
          >
            <CheckCircle2 size={18} />
            <span className="font-semibold">Copied!</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
