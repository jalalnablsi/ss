'use client';

import React, { useState } from 'react';
import { useGame } from './GameProvider';
import { Users, Copy, CheckCircle2, Gift } from 'lucide-react';
import { motion } from 'motion/react';

export function FriendsScreen() {
  const { referralsCount, referralsActivated, referralCoinsEarned, claimReferralReward } = useGame();
  const [copied, setCopied] = useState(false);

  const tgUserStr = typeof window !== 'undefined' ? window.Telegram?.WebApp?.initDataUnsafe?.user : null;
  const currentUserId = tgUserStr?.id?.toString() || '123456';
  const inviteLink = `https://t.me/TapToEarnBot?start=ref${currentUserId}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Calculate unrewarded referrals (for demo purposes)
  // Rewards are now added automatically by the backend
  // const unrewarded = referralsActivated - (referralCoinsEarned / 1500);

  return (
    <div className="w-full h-full pb-28 pt-8 px-5 overflow-y-auto">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 text-indigo-400 mb-5 shadow-[0_0_30px_rgba(99,102,241,0.15)]">
          <Users size={40} />
        </div>
        <h2 className="text-4xl font-black text-white mb-3 tracking-tight">Frens</h2>
        <p className="text-zinc-400 text-sm">Invite friends and earn 1,500 coins for each active friend!</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 text-center">
          <div className="text-zinc-400 text-xs font-bold uppercase tracking-wider mb-1">Total Frens</div>
          <div className="text-2xl font-black text-white">{referralsCount}</div>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 text-center">
          <div className="text-zinc-400 text-xs font-bold uppercase tracking-wider mb-1">Active Frens</div>
          <div className="text-2xl font-black text-green-400">{referralsActivated}</div>
        </div>
      </div>
      
      <div className="bg-white/5 border border-white/10 rounded-2xl p-4 text-center mb-8">
        <div className="text-zinc-400 text-xs font-bold uppercase tracking-wider mb-1">Coins Earned</div>
        <div className="text-2xl font-black text-yellow-400">{referralCoinsEarned.toLocaleString()}</div>
      </div>

      {/* Rules Box */}
      <div className="bg-gradient-to-br from-indigo-500/10 to-purple-500/10 border border-indigo-500/20 rounded-3xl p-5 mb-8">
        <h3 className="text-white font-bold mb-3 flex items-center gap-2">
          <Gift size={18} className="text-indigo-400" /> 
          How it works
        </h3>
        <ul className="space-y-3 text-sm text-zinc-300">
          <li className="flex items-start gap-2">
            <span className="text-indigo-400 font-bold">1.</span>
            Share your invite link with your friends.
          </li>
          <li className="flex items-start gap-2">
            <span className="text-indigo-400 font-bold">2.</span>
            Friend joins and starts tapping.
          </li>
          <li className="flex items-start gap-2">
            <span className="text-indigo-400 font-bold">3.</span>
            Once your friend reaches <strong className="text-white">500 taps</strong>, they become &quot;Active&quot;.
          </li>
          <li className="flex items-start gap-2">
            <span className="text-indigo-400 font-bold">4.</span>
            You automatically earn <strong className="text-yellow-400">1,500 Coins</strong>!
          </li>
        </ul>
      </div>

      {/* Invite Link */}
      <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex items-center gap-3">
        <div className="flex-1 overflow-hidden">
          <div className="text-xs text-zinc-500 font-bold uppercase tracking-wider mb-1">Your Invite Link</div>
          <div className="text-white text-sm truncate">{inviteLink}</div>
        </div>
        <button 
          onClick={handleCopy}
          className="w-12 h-12 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors shrink-0"
        >
          {copied ? <CheckCircle2 size={20} className="text-green-400" /> : <Copy size={20} className="text-white" />}
        </button>
      </div>

      <button 
        onClick={() => {
          // In Telegram Mini App, use Telegram WebApp API to open share dialog
          // window.Telegram.WebApp.openTelegramLink(`https://t.me/share/url?url=${inviteLink}&text=Join me and earn coins!`);
          handleCopy();
        }}
        className="w-full mt-4 py-4 rounded-2xl font-bold bg-white text-black hover:bg-zinc-200 active:scale-[0.98] transition-all"
      >
        Invite a Friend
      </button>
    </div>
  );
}
