'use client';

import React, { useState } from 'react';
import { GameProvider } from '@/components/GameProvider';
import { TapScreen } from '@/components/TapScreen';
import { BoostsScreen } from '@/components/BoostsScreen';
import { TasksScreen } from '@/components/TasksScreen';
import { LeaderboardScreen } from '@/components/LeaderboardScreen';
import { FriendsScreen } from '@/components/FriendsScreen';
import { Hand, Zap, CheckSquare, Trophy, Users } from 'lucide-react';

type Tab = 'tap' | 'boosts' | 'tasks' | 'frens' | 'leaderboard';

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>('tap');

  const tabs = [
    { id: 'tap', label: 'Tap', icon: <Hand size={22} /> },
    { id: 'boosts', label: 'Boosts', icon: <Zap size={22} /> },
    { id: 'tasks', label: 'Tasks', icon: <CheckSquare size={22} /> },
    { id: 'frens', label: 'Frens', icon: <Users size={22} /> },
    { id: 'leaderboard', label: 'Rank', icon: <Trophy size={22} /> },
  ] as const;

  return (
    <GameProvider>
      <main className="h-[100dvh] w-full max-w-md mx-auto bg-[#050505] relative flex flex-col overflow-hidden">
        
        {/* Content Area */}
        <div className="flex-1 overflow-hidden relative">
          {activeTab === 'tap' && <TapScreen />}
          {activeTab === 'boosts' && <BoostsScreen />}
          {activeTab === 'tasks' && <TasksScreen />}
          {activeTab === 'frens' && <FriendsScreen />}
          {activeTab === 'leaderboard' && <LeaderboardScreen />}
        </div>

        {/* Bottom Navigation */}
        <div className="absolute bottom-0 left-0 right-0 bg-[#0a0a0a]/80 backdrop-blur-2xl border-t border-white/5 pb-safe pt-3 px-4 z-50">
          <div className="flex justify-between items-center max-w-md mx-auto pb-5">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as Tab)}
                  className={`flex flex-col items-center justify-center w-14 gap-1.5 transition-all duration-300 ${
                    isActive ? 'text-yellow-400 scale-110' : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  <div className={`relative p-2 rounded-2xl transition-all duration-300 ${isActive ? 'bg-yellow-400/10 shadow-[0_0_15px_rgba(250,204,21,0.15)]' : ''}`}>
                    {tab.icon}
                  </div>
                  <span className="text-[10px] font-semibold tracking-wide">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </main>
    </GameProvider>
  );
}
