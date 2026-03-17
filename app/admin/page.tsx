'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Users, PlaySquare, CheckSquare, Plus, Edit, Trash2, LogOut, Timer, XCircle } from 'lucide-react';

export default function AdminDashboard() {
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const [stats, setStats] = useState({ totalUsers: 0, totalAds: 0, totalTasksCompleted: 0 });
  const [tasks, setTasks] = useState<any[]>([]);
  const [isEditingTask, setIsEditingTask] = useState(false);
  const [currentTask, setCurrentTask] = useState<any>(null);

  const [activeChallenge, setActiveChallenge] = useState<any>(null);
  const [challengeDays, setChallengeDays] = useState(7);
  const [addDays, setAddDays] = useState(1);
  const [isChallengeLoading, setIsChallengeLoading] = useState(false);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const res = await fetch('/api/admin/stats');
      if (res.ok) {
        setIsAuthenticated(true);
        fetchData();
      } else {
        setIsAuthenticated(false);
      }
    } catch (e) {
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (res.ok) {
        setIsAuthenticated(true);
        fetchData();
      } else {
        const data = await res.json();
        setLoginError(data.error || 'Login failed');
      }
    } catch (e) {
      setLoginError('An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    document.cookie = 'admin_session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    setIsAuthenticated(false);
  };

  const fetchData = async () => {
    try {
      const [statsRes, tasksRes, challengeRes] = await Promise.all([
        fetch('/api/admin/stats'),
        fetch('/api/admin/tasks'),
        fetch('/api/admin/challenge')
      ]);

      if (statsRes.ok) setStats(await statsRes.json());
      if (tasksRes.ok) {
        const data = await tasksRes.json();
        setTasks(data.tasks);
      }
      if (challengeRes.ok) {
        const data = await challengeRes.json();
        setActiveChallenge(data.challenge);
      }
    } catch (e) {
      console.error('Failed to fetch data', e);
    }
  };

  const saveTask = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    
    try {
      const method = currentTask.isNew ? 'POST' : 'PUT';
      const res = await fetch('/api/admin/tasks', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentTask),
      });

      if (res.ok) {
        setIsEditingTask(false);
        fetchData();
      } else {
        alert('Failed to save task');
      }
    } catch (e) {
      alert('Error saving task');
    } finally {
      setIsLoading(false);
    }
  };

  const deleteTask = async (id: string) => {
    if (!confirm('Are you sure you want to delete this task?')) return;
    
    try {
      const res = await fetch(`/api/admin/tasks?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchData();
      } else {
        alert('Failed to delete task');
      }
    } catch (e) {
      alert('Error deleting task');
    }
  };

  const startChallenge = async () => {
    if (!confirm(`Start a new challenge for ${challengeDays} days? This will reset all challenge coins to 0.`)) return;
    setIsChallengeLoading(true);
    try {
      const res = await fetch('/api/admin/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: challengeDays }),
      });
      if (res.ok) {
        fetchData();
      } else {
        alert('Failed to start challenge');
      }
    } catch (e) {
      alert('Error starting challenge');
    } finally {
      setIsChallengeLoading(false);
    }
  };

  const extendChallenge = async () => {
    if (!activeChallenge) return;
    setIsChallengeLoading(true);
    try {
      const res = await fetch('/api/admin/challenge', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: activeChallenge.id, addDays }),
      });
      if (res.ok) {
        fetchData();
      } else {
        alert('Failed to extend challenge');
      }
    } catch (e) {
      alert('Error extending challenge');
    } finally {
      setIsChallengeLoading(false);
    }
  };

  const endChallenge = async () => {
    if (!activeChallenge || !confirm('Are you sure you want to end the active challenge immediately?')) return;
    setIsChallengeLoading(true);
    try {
      const res = await fetch(`/api/admin/challenge?id=${activeChallenge.id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchData();
      } else {
        alert('Failed to end challenge');
      }
    } catch (e) {
      alert('Error ending challenge');
    } finally {
      setIsChallengeLoading(false);
    }
  };

  if (isLoading && !isAuthenticated) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="animate-spin text-blue-500" size={48} />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        <div className="bg-zinc-900 p-8 rounded-2xl w-full max-w-md border border-zinc-800 shadow-2xl">
          <h1 className="text-2xl font-bold text-white mb-6 text-center">Admin Login</h1>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-zinc-400 text-sm mb-1">Email</label>
              <input 
                type="email" 
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-zinc-400 text-sm mb-1">Password</label>
              <input 
                type="password" 
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500"
                required
              />
            </div>
            {loginError && <p className="text-red-500 text-sm">{loginError}</p>}
            <button 
              type="submit" 
              disabled={isLoading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-colors flex justify-center items-center"
            >
              {isLoading ? <Loader2 className="animate-spin" size={20} /> : 'Login'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-6 md:p-10">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-10">
          <h1 className="text-3xl font-bold">Admin Dashboard</h1>
          <button onClick={handleLogout} className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors">
            <LogOut size={20} />
            <span>Logout</span>
          </button>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-500">
              <Users size={28} />
            </div>
            <div>
              <p className="text-zinc-400 text-sm">Total Users</p>
              <p className="text-3xl font-bold">{stats.totalUsers}</p>
            </div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-green-500/20 flex items-center justify-center text-green-500">
              <PlaySquare size={28} />
            </div>
            <div>
              <p className="text-zinc-400 text-sm">Total Ads Watched</p>
              <p className="text-3xl font-bold">{stats.totalAds}</p>
            </div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-500">
              <CheckSquare size={28} />
            </div>
            <div>
              <p className="text-zinc-400 text-sm">Tasks Completed</p>
              <p className="text-3xl font-bold">{stats.totalTasksCompleted}</p>
            </div>
          </div>
        </div>

        {/* Challenge Management */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 mb-10">
          <div className="flex items-center gap-3 mb-6">
            <Timer className="text-orange-500" size={24} />
            <h2 className="text-xl font-bold">Challenge Management</h2>
          </div>

          {activeChallenge ? (
            <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-6">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="text-lg font-bold text-orange-400 mb-1">Active Challenge</h3>
                  <p className="text-zinc-400 text-sm">
                    Ends on: {new Date(activeChallenge.end_time).toLocaleString()}
                  </p>
                </div>
                <button 
                  onClick={endChallenge}
                  disabled={isChallengeLoading}
                  className="flex items-center gap-2 bg-red-500/20 text-red-500 hover:bg-red-500/30 px-4 py-2 rounded-lg transition-colors font-medium text-sm"
                >
                  <XCircle size={18} />
                  End Now
                </button>
              </div>

              <div className="flex items-end gap-4 max-w-md">
                <div className="flex-1">
                  <label className="block text-zinc-400 text-sm mb-2">Add Days to Challenge</label>
                  <input 
                    type="number" 
                    min="1"
                    value={addDays}
                    onChange={e => setAddDays(parseInt(e.target.value) || 1)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white"
                  />
                </div>
                <button 
                  onClick={extendChallenge}
                  disabled={isChallengeLoading}
                  className="bg-orange-600 hover:bg-orange-700 text-white px-6 py-2 rounded-xl transition-colors font-medium h-[42px] flex items-center justify-center"
                >
                  {isChallengeLoading ? <Loader2 className="animate-spin" size={18} /> : 'Extend'}
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-6">
              <h3 className="text-lg font-bold mb-2">No Active Challenge</h3>
              <p className="text-zinc-400 text-sm mb-6">Start a new challenge to reset the challenge leaderboard.</p>
              
              <div className="flex items-end gap-4 max-w-md">
                <div className="flex-1">
                  <label className="block text-zinc-400 text-sm mb-2">Duration (Days)</label>
                  <input 
                    type="number" 
                    min="1"
                    value={challengeDays}
                    onChange={e => setChallengeDays(parseInt(e.target.value) || 1)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2 text-white"
                  />
                </div>
                <button 
                  onClick={startChallenge}
                  disabled={isChallengeLoading}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-xl transition-colors font-medium h-[42px] flex items-center justify-center"
                >
                  {isChallengeLoading ? <Loader2 className="animate-spin" size={18} /> : 'Start Challenge'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Tasks Management */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold">Tasks Management</h2>
            <button 
              onClick={() => {
                setCurrentTask({ id: '', title: '', description: '', reward_coins: 1000, link: '', icon_name: 'Link', is_active: true, isNew: true });
                setIsEditingTask(true);
              }}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition-colors"
            >
              <Plus size={20} />
              <span>Add Task</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-zinc-400 border-b border-zinc-800">
                  <th className="pb-3 font-medium">ID</th>
                  <th className="pb-3 font-medium">Title</th>
                  <th className="pb-3 font-medium">Reward</th>
                  <th className="pb-3 font-medium">Status</th>
                  <th className="pb-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map(task => (
                  <tr key={task.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/20">
                    <td className="py-4 text-sm font-mono text-zinc-400">{task.id}</td>
                    <td className="py-4 font-medium">{task.title}</td>
                    <td className="py-4 text-yellow-500 font-bold">{task.reward_coins}</td>
                    <td className="py-4">
                      <span className={`px-2 py-1 rounded text-xs font-bold ${task.is_active ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'}`}>
                        {task.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="py-4 text-right">
                      <button 
                        onClick={() => { setCurrentTask({ ...task, isNew: false }); setIsEditingTask(true); }}
                        className="p-2 text-zinc-400 hover:text-blue-500 transition-colors inline-block"
                      >
                        <Edit size={18} />
                      </button>
                      <button 
                        onClick={() => deleteTask(task.id)}
                        className="p-2 text-zinc-400 hover:text-red-500 transition-colors inline-block"
                      >
                        <Trash2 size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Task Edit Modal */}
      {isEditingTask && currentTask && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-lg">
            <h2 className="text-xl font-bold mb-6">{currentTask.isNew ? 'Add New Task' : 'Edit Task'}</h2>
            <form onSubmit={saveTask} className="space-y-4">
              <div>
                <label className="block text-zinc-400 text-sm mb-1">Task ID (Unique)</label>
                <input 
                  type="text" 
                  value={currentTask.id}
                  onChange={e => setCurrentTask({...currentTask, id: e.target.value})}
                  disabled={!currentTask.isNew}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white disabled:opacity-50"
                  required
                />
              </div>
              <div>
                <label className="block text-zinc-400 text-sm mb-1">Title</label>
                <input 
                  type="text" 
                  value={currentTask.title}
                  onChange={e => setCurrentTask({...currentTask, title: e.target.value})}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-zinc-400 text-sm mb-1">Description</label>
                <input 
                  type="text" 
                  value={currentTask.description}
                  onChange={e => setCurrentTask({...currentTask, description: e.target.value})}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-zinc-400 text-sm mb-1">Reward Coins</label>
                  <input 
                    type="number" 
                    value={currentTask.reward_coins}
                    onChange={e => setCurrentTask({...currentTask, reward_coins: parseInt(e.target.value)})}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white"
                    required
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 text-sm mb-1">Icon Name (Lucide)</label>
                  <input 
                    type="text" 
                    value={currentTask.icon_name}
                    onChange={e => setCurrentTask({...currentTask, icon_name: e.target.value})}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white"
                    placeholder="e.g. Twitter, Youtube"
                  />
                </div>
              </div>
              <div>
                <label className="block text-zinc-400 text-sm mb-1">Link URL</label>
                <input 
                  type="url" 
                  value={currentTask.link}
                  onChange={e => setCurrentTask({...currentTask, link: e.target.value})}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white"
                />
              </div>
              <div className="flex items-center gap-2 mt-2">
                <input 
                  type="checkbox" 
                  id="isActive"
                  checked={currentTask.is_active}
                  onChange={e => setCurrentTask({...currentTask, is_active: e.target.checked})}
                  className="w-5 h-5 rounded border-zinc-800 bg-zinc-950"
                />
                <label htmlFor="isActive" className="text-white">Active (Visible to users)</label>
              </div>
              
              <div className="flex gap-3 pt-4">
                <button 
                  type="button"
                  onClick={() => setIsEditingTask(false)}
                  className="flex-1 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 transition-colors font-medium"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={isLoading}
                  className="flex-1 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 transition-colors font-medium flex justify-center items-center"
                >
                  {isLoading ? <Loader2 className="animate-spin" size={20} /> : 'Save Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
