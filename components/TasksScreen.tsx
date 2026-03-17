'use client';

import React, { useEffect, useState } from 'react';
import { useGame } from './GameProvider';
import { CheckCircle2, ChevronRight, Send, Twitter, Youtube, Users, Wallet, Link as LinkIcon, MessageCircle } from 'lucide-react';
import { TonConnectButton } from '@tonconnect/ui-react';

export function TasksScreen() {
  const { claimTask, completedTasks, walletConnected } = useGame();
  const [tasks, setTasks] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchTasks = async () => {
      try {
        const res = await fetch('/api/tasks/list');
        if (res.ok) {
          const data = await res.json();
          setTasks(data.tasks || []);
        }
      } catch (e) {
        console.error('Failed to fetch tasks', e);
      } finally {
        setIsLoading(false);
      }
    };
    fetchTasks();
  }, []);

  const getIcon = (iconName: string) => {
    switch (iconName) {
      case 'Twitter': return <Twitter size={22} className="text-white" />;
      case 'Youtube': return <Youtube size={22} className="text-red-500" />;
      case 'MessageCircle': return <MessageCircle size={22} className="text-blue-400" />;
      case 'Wallet': return <Wallet size={22} className="text-blue-400" />;
      default: return <LinkIcon size={22} className="text-zinc-400" />;
    }
  };

  const handleTaskClick = (task: any) => {
    if (completedTasks.includes(task.id)) return;
    
    if (task.link) {
      window.open(task.link, '_blank');
    }
    
    setTimeout(() => {
      claimTask(task.reward_coins, task.id);
    }, 2000);
  };

  return (
    <div className="w-full h-full pb-28 pt-8 px-5 overflow-y-auto">
      <div className="text-center mb-10">
        <h2 className="text-4xl font-black text-white mb-3 tracking-tight">Earn More</h2>
        <p className="text-zinc-400 text-sm">Complete simple tasks to earn thousands of free coins!</p>
      </div>

      <div className="space-y-4">
        {/* Special Wallet Task (Always show if not in DB, but we assume it is) */}
        
        {isLoading ? (
          <div className="text-center text-zinc-500 py-10">Loading tasks...</div>
        ) : (
          tasks.map((task) => {
            const isCompleted = completedTasks.includes(task.id);
            const isWalletTask = task.id === 'connect_wallet';
            
            if (isWalletTask) {
              return (
                <div key={task.id} className={`w-full flex items-center justify-between p-5 rounded-3xl border transition-all duration-300 ${
                    walletConnected 
                      ? 'bg-blue-500/10 border-blue-500/20' 
                      : 'bg-gradient-to-r from-blue-600/20 to-cyan-500/20 border-blue-500/30 shadow-[0_0_20px_rgba(59,130,246,0.15)]'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center shrink-0 shadow-inner">
                      <Wallet size={22} className="text-blue-400" />
                    </div>
                    <div className="text-left">
                      <h3 className="font-bold text-white text-base mb-1">{task.title}</h3>
                      <div className="flex items-center gap-1.5 text-yellow-400 font-bold text-sm">
                        <span>+{task.reward_coins.toLocaleString()}</span>
                        <span className="text-yellow-400/70">Coins</span>
                      </div>
                    </div>
                  </div>

                  <div className="shrink-0">
                    {walletConnected ? (
                      <CheckCircle2 size={24} className="text-blue-400" />
                    ) : (
                      <TonConnectButton />
                    )}
                  </div>
                </div>
              );
            }

            return (
              <button
                key={task.id}
                onClick={() => handleTaskClick(task)}
                disabled={isCompleted}
                className={`w-full flex items-center justify-between p-5 rounded-3xl border transition-all duration-300 ${
                  isCompleted 
                    ? 'bg-white/5 border-white/5 opacity-50 cursor-not-allowed' 
                    : 'bg-white/10 border-white/10 hover:bg-white/15 active:scale-[0.98] shadow-lg'
                }`}
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-black/40 border border-white/5 flex items-center justify-center shrink-0 shadow-inner">
                    {getIcon(task.icon_name)}
                  </div>
                  <div className="text-left">
                    <h3 className="font-bold text-white text-base mb-1">{task.title}</h3>
                    <div className="flex items-center gap-1.5 text-yellow-400 font-bold text-sm">
                      <span>+{task.reward_coins.toLocaleString()}</span>
                      <span className="text-yellow-400/70">Coins</span>
                    </div>
                  </div>
                </div>

                <div className="shrink-0">
                  {isCompleted ? (
                    <CheckCircle2 size={24} className="text-green-500" />
                  ) : (
                    <ChevronRight size={20} className="text-zinc-500" />
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
