'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Loader2, Users, PlaySquare, CheckSquare, Plus, Edit, Trash2, 
  LogOut, Timer, XCircle, Search, ShieldCheck, Activity, 
  ChevronRight, Save, RefreshCw, AlertCircle 
} from 'lucide-react';

// --- Types ---
interface Task {
  id: string;
  title: string;
  description: string;
  reward_coins: number;
  link: string | null;
  icon_name: string;
  is_active: boolean;
  created_at: string;
  isNew?: boolean;
}

interface Stats {
  totalUsers: number;
  totalAds: number;
  totalTasksCompleted: number;
}

interface Challenge {
  id: string;
  end_time: string;
  days: number;
}

export default function AdminDashboard() {
  const router = useRouter();
  
  // State Management
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loginData, setLoginData] = useState({ email: '', password: '' });
  const [loginError, setLoginError] = useState('');

  // Data State
  const [stats, setStats] = useState<Stats>({ totalUsers: 0, totalAds: 0, totalTasksCompleted: 0 });
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeChallenge, setActiveChallenge] = useState<Challenge | null>(null);
  const [settings, setSettings] = useState({ adsgram_block_id: '' });

  // UI State
  const [isEditingTask, setIsEditingTask] = useState(false);
  const [currentTask, setCurrentTask] = useState<Partial<Task> & { isNew?: boolean }>({});
  const [challengeDays, setChallengeDays] = useState(7);
  const [addDays, setAddDays] = useState(1);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // --- Effects ---
  useEffect(() => {
    checkAuth();
  }, []);

  // --- Auth Logic ---
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
    setActionLoading('login');

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginData),
      });

      if (res.ok) {
        setIsAuthenticated(true);
        fetchData();
      } else {
        const data = await res.json();
        setLoginError(data.error || 'فشل تسجيل الدخول');
      }
    } catch (e) {
      setLoginError('حدث خطأ في الاتصال');
    } finally {
      setActionLoading(null);
    }
  };

  const handleLogout = () => {
    document.cookie = 'admin_session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    setIsAuthenticated(false);
  };

  // --- Data Fetching ---
  const fetchData = async () => {
    try {
      const [statsRes, tasksRes, challengeRes, settingsRes] = await Promise.all([
        fetch('/api/admin/stats'),
        fetch('/api/admin/tasks'),
        fetch('/api/admin/challenge'),
        fetch('/api/admin/settings')
      ]);

      if (statsRes.ok) setStats(await statsRes.json());
      
      if (tasksRes.ok) {
        const data = await tasksRes.json();
        // تنسيق البيانات لضمان توافق الأنواع
        const formatted = (data.tasks || []).map((t: any) => ({
          ...t,
          is_active: t.is_active === true || t.is_active === 1,
          isNew: false
        }));
        setTasks(formatted);
      }

      if (challengeRes.ok) {
        const data = await challengeRes.json();
        setActiveChallenge(data.challenge);
      }

      if (settingsRes.ok) {
        const data = await settingsRes.json();
        setSettings({ adsgram_block_id: data.settings?.adsgram_block_id || '' });
      }
    } catch (e) {
      console.error('Fetch error:', e);
    }
  };

  // --- Actions ---
  const saveTask = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading('saveTask');
    try {
      const method = currentTask.isNew ? 'POST' : 'PUT'; // ملاحظة: الـ API يتعامل مع POST كـ Upsert في الكود السابق
      const res = await fetch('/api/admin/tasks', {
        method: 'POST', // نستخدم POST دائماً للتبسيط حسب كود الـ API المقترح
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentTask),
      });

      if (res.ok) {
        setIsEditingTask(false);
        await fetchData();
      } else {
        alert('فشل حفظ المهمة');
      }
    } catch (e) {
      alert('خطأ في الحفظ');
    } finally {
      setActionLoading(null);
    }
  };

  const deleteTask = async (id: string) => {
    if (!confirm('هل أنت متأكد من حذف هذه المهمة؟')) return;
    setActionLoading(`delete-${id}`);
    try {
      const res = await fetch(`/api/admin/tasks?id=${id}`, { method: 'DELETE' });
      if (res.ok) await fetchData();
      else alert('فشل الحذف');
    } catch (e) {
      alert('خطأ');
    } finally {
      setActionLoading(null);
    }
  };

  const startChallenge = async () => {
    if (!confirm(`بدء تحدي جديد لمدة ${challengeDays} يوم؟`)) return;
    setActionLoading('challenge');
    try {
      const res = await fetch('/api/admin/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: challengeDays }),
      });
      if (res.ok) await fetchData();
    } finally { setActionLoading(null); }
  };

  const extendChallenge = async () => {
    if (!activeChallenge) return;
    setActionLoading('challenge');
    try {
      const res = await fetch('/api/admin/challenge', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: activeChallenge.id, addDays }),
      });
      if (res.ok) await fetchData();
    } finally { setActionLoading(null); }
  };

  const endChallenge = async () => {
    if (!activeChallenge || !confirm('إنهاء التحدي فوراً؟')) return;
    setActionLoading('challenge');
    try {
      const res = await fetch(`/api/admin/challenge?id=${activeChallenge.id}`, { method: 'DELETE' });
      if (res.ok) await fetchData();
    } finally { setActionLoading(null); }
  };

  const saveSettings = async () => {
    setActionLoading('settings');
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (res.ok) alert('تم حفظ الإعدادات بنجاح');
    } finally { setActionLoading(null); }
  };

  // --- Render: Loading ---
  if (isLoading && !isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="relative">
          <div className="absolute inset-0 bg-indigo-500 blur-xl opacity-20 animate-pulse rounded-full"></div>
          <Loader2 className="relative text-indigo-400 animate-spin" size={64} />
        </div>
      </div>
    );
  }

  // --- Render: Login ---
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 relative overflow-hidden">
        {/* Background Decor */}
        <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-indigo-600/20 rounded-full blur-[100px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-emerald-600/10 rounded-full blur-[100px]" />

        <div className="bg-slate-900/60 backdrop-blur-xl border border-slate-700/50 p-8 rounded-3xl w-full max-w-md shadow-2xl relative z-10">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 mb-4 shadow-lg shadow-indigo-500/30">
              <ShieldCheck className="text-white" size={32} />
            </div>
            <h1 className="text-3xl font-bold text-white tracking-tight">لوحة القيادة</h1>
            <p className="text-slate-400 mt-2 text-sm">تسجيل دخول المشرفين فقط</p>
          </div>
          
          <form onSubmit={handleLogin} className="space-y-5">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider ml-1">البريد الإلكتروني</label>
              <input 
                type="email" 
                value={loginData.email}
                onChange={e => setLoginData({...loginData, email: e.target.value})}
                className="w-full bg-slate-950/50 border border-slate-700 rounded-xl px-4 py-3.5 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all placeholder:text-slate-600"
                placeholder="admin@game.com"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider ml-1">كلمة المرور</label>
              <input 
                type="password" 
                value={loginData.password}
                onChange={e => setLoginData({...loginData, password: e.target.value})}
                className="w-full bg-slate-950/50 border border-slate-700 rounded-xl px-4 py-3.5 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all placeholder:text-slate-600"
                placeholder="••••••••"
                required
              />
            </div>
            
            {loginError && (
              <div className="flex items-center gap-2 text-red-400 bg-red-500/10 p-3 rounded-lg text-sm border border-red-500/20">
                <AlertCircle size={16} />
                {loginError}
              </div>
            )}

            <button 
              type="submit" 
              disabled={actionLoading === 'login'}
              className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold py-3.5 rounded-xl transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-indigo-600/30 flex justify-center items-center"
            >
              {actionLoading === 'login' ? <Loader2 className="animate-spin" size={20} /> : 'دخول آمن'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // --- Render: Dashboard ---
  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 p-4 md:p-8 font-sans selection:bg-indigo-500/30">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-800/50">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
              <span className="w-2 h-8 bg-indigo-500 rounded-full"></span>
              لوحة التحكم
            </h1>
            <p className="text-slate-400 mt-1 text-sm">إدارة اللعبة والمستخدمين والتحديات</p>
          </div>
          <button 
            onClick={handleLogout} 
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 transition-all text-sm font-medium"
          >
            <LogOut size={18} />
            خروج
          </button>
        </header>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { label: 'إجمالي المستخدمين', value: stats.totalUsers, icon: Users, color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
            { label: 'الإعلانات المشاهدة', value: stats.totalAds, icon: PlaySquare, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
            { label: 'المهام المنجزة', value: stats.totalTasksCompleted, icon: CheckSquare, color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20' },
          ].map((stat, idx) => (
            <div key={idx} className={`relative overflow-hidden bg-slate-900/50 backdrop-blur-sm border ${stat.border} rounded-2xl p-6 group hover:bg-slate-800/50 transition-all duration-300`}>
              <div className="flex items-center justify-between relative z-10">
                <div>
                  <p className="text-slate-400 text-sm font-medium mb-1">{stat.label}</p>
                  <p className="text-4xl font-bold text-white tracking-tight">{stat.value.toLocaleString()}</p>
                </div>
                <div className={`w-14 h-14 rounded-2xl ${stat.bg} flex items-center justify-center ${stat.color} group-hover:scale-110 transition-transform duration-300`}>
                  <stat.icon size={28} strokeWidth={1.5} />
                </div>
              </div>
              {/* Decorative gradient blob */}
              <div className={`absolute -right-6 -bottom-6 w-24 h-24 ${stat.bg} blur-2xl rounded-full opacity-50 group-hover:opacity-70 transition-opacity`} />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left Column: Tasks (Takes 2 columns) */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-slate-900/50 backdrop-blur-sm border border-slate-800 rounded-3xl p-6 shadow-xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-indigo-500/20 rounded-lg text-indigo-400">
                    <Activity size={24} />
                  </div>
                  <h2 className="text-xl font-bold text-white">إدارة المهام</h2>
                </div>
                <button 
                  onClick={() => {
                    setCurrentTask({ id: '', title: '', description: '', reward_coins: 1000, link: '', icon_name: 'Link', is_active: true, isNew: true });
                    setIsEditingTask(true);
                  }}
                  className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-xl transition-all shadow-lg shadow-indigo-600/20 hover:shadow-indigo-600/40 font-medium text-sm"
                >
                  <Plus size={18} />
                  إضافة مهمة جديدة
                </button>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-slate-800/50">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-950/50 text-slate-400 text-xs uppercase tracking-wider">
                      <th className="p-4 font-semibold">المعرف / العنوان</th>
                      <th className="p-4 font-semibold">المكافأة</th>
                      <th className="p-4 font-semibold">الحالة</th>
                      <th className="p-4 font-semibold text-right">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {tasks.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="p-8 text-center text-slate-500">
                          لا توجد مهام حالياً. اضغط على "إضافة مهمة" للبدء.
                        </td>
                      </tr>
                    ) : (
                      tasks.map(task => (
                        <tr key={task.id} className="hover:bg-slate-800/30 transition-colors group">
                          <td className="p-4">
                            <div className="font-bold text-white">{task.title}</div>
                            <div className="text-xs text-slate-500 font-mono mt-1">{task.id}</div>
                          </td>
                          <td className="p-4">
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-yellow-500/10 text-yellow-400 text-sm font-bold border border-yellow-500/20">
                              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400"></span>
                              {task.reward_coins.toLocaleString()}
                            </span>
                          </td>
                          <td className="p-4">
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold border ${
                              task.is_active 
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                                : 'bg-slate-700/30 text-slate-400 border-slate-600/30'
                            }`}>
                              {task.is_active ? 'نشط' : 'غير نشط'}
                            </span>
                          </td>
                          <td className="p-4 text-right">
                            <div className="flex items-center justify-end gap-2 opacity-70 group-hover:opacity-100 transition-opacity">
                              <button 
                                onClick={() => { setCurrentTask({ ...task, isNew: false }); setIsEditingTask(true); }}
                                className="p-2 rounded-lg bg-slate-800 text-slate-400 hover:text-indigo-400 hover:bg-indigo-500/10 transition-all"
                                title="تعديل"
                              >
                                <Edit size={18} />
                              </button>
                              <button 
                                onClick={() => deleteTask(task.id)}
                                disabled={actionLoading?.startsWith(`delete-${task.id}`)}
                                className="p-2 rounded-lg bg-slate-800 text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-all"
                                title="حذف"
                              >
                                {actionLoading === `delete-${task.id}` ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={18} />}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Right Column: Challenge & Settings */}
          <div className="space-y-6">
            
            {/* Challenge Card */}
            <div className="bg-slate-900/50 backdrop-blur-sm border border-slate-800 rounded-3xl p-6 shadow-xl">
              <div className="flex items-center gap-3 mb-6">
                <div className={`p-2 rounded-lg ${activeChallenge ? 'bg-orange-500/20 text-orange-400' : 'bg-slate-800 text-slate-400'}`}>
                  <Timer size={24} />
                </div>
                <h2 className="text-xl font-bold text-white">التحدي الحالي</h2>
              </div>

              {activeChallenge ? (
                <div className="space-y-4">
                  <div className="bg-orange-500/10 border border-orange-500/20 rounded-2xl p-4">
                    <p className="text-orange-200 text-sm font-medium mb-1">ينتهي في</p>
                    <p className="text-white font-mono text-lg">{new Date(activeChallenge.end_time).toLocaleDateString('ar-EG')}</p>
                  </div>
                  
                  <div className="flex gap-2">
                    <input 
                      type="number" min="1" value={addDays}
                      onChange={e => setAddDays(parseInt(e.target.value))}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white text-center focus:border-orange-500 outline-none"
                    />
                    <button 
                      onClick={extendChallenge}
                      disabled={actionLoading === 'challenge'}
                      className="bg-orange-600 hover:bg-orange-500 text-white px-4 rounded-xl font-medium transition-colors flex items-center justify-center min-w-[80px]"
                    >
                      {actionLoading === 'challenge' ? <Loader2 size={18} className="animate-spin"/> : <RefreshCw size={18}/>}
                    </button>
                  </div>
                  <button 
                    onClick={endChallenge}
                    className="w-full py-3 rounded-xl border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors text-sm font-bold flex items-center justify-center gap-2"
                  >
                    <XCircle size={16} /> إنهاء التحدي
                  </button>
                </div>
              ) : (
                <div className="text-center space-y-4">
                  <p className="text-slate-400 text-sm">لا يوجد تحدي نشط حالياً.</p>
                  <div className="flex items-center gap-2 bg-slate-950 p-1 rounded-xl border border-slate-800">
                    <input 
                      type="number" min="1" value={challengeDays}
                      onChange={e => setChallengeDays(parseInt(e.target.value))}
                      className="w-full bg-transparent text-center text-white py-2 outline-none"
                    />
                    <span className="text-slate-500 text-sm pr-2">يوم</span>
                  </div>
                  <button 
                    onClick={startChallenge}
                    disabled={actionLoading === 'challenge'}
                    className="w-full bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-500 hover:to-red-500 text-white py-3 rounded-xl font-bold shadow-lg shadow-orange-900/20 transition-all"
                  >
                    بدء تحدي جديد
                  </button>
                </div>
              )}
            </div>

            {/* Settings Card */}
            <div className="bg-slate-900/50 backdrop-blur-sm border border-slate-800 rounded-3xl p-6 shadow-xl">
              <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <ShieldCheck size={20} className="text-indigo-400"/> إعدادات النظام
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5 ml-1">Adsgram Block ID</label>
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      value={settings.adsgram_block_id}
                      onChange={e => setSettings({...settings, adsgram_block_id: e.target.value})}
                      className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-white text-sm focus:border-indigo-500 outline-none transition-colors"
                      placeholder="12345"
                    />
                    <button 
                      onClick={saveSettings}
                      disabled={actionLoading === 'settings'}
                      className="bg-slate-800 hover:bg-slate-700 text-white p-2.5 rounded-xl border border-slate-700 transition-colors"
                    >
                      {actionLoading === 'settings' ? <Loader2 size={18} className="animate-spin"/> : <Save size={18}/>}
                    </button>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* Edit/Add Modal */}
      {isEditingTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-950/50">
              <h3 className="text-xl font-bold text-white">
                {currentTask.isNew ? 'إضافة مهمة جديدة' : 'تعديل المهمة'}
              </h3>
              <button onClick={() => setIsEditingTask(false)} className="text-slate-400 hover:text-white transition-colors">
                <XCircle size={24} />
              </button>
            </div>
            
            <form onSubmit={saveTask} className="p-6 space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-400 uppercase mb-1.5 ml-1">المعرف الفريد (ID)</label>
                  <input 
                    type="text" 
                    value={currentTask.id}
                    onChange={e => setCurrentTask({...currentTask, id: e.target.value})}
                    disabled={!currentTask.isNew}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white focus:border-indigo-500 outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                    required
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-400 uppercase mb-1.5 ml-1">العنوان</label>
                  <input 
                    type="text" 
                    value={currentTask.title}
                    onChange={e => setCurrentTask({...currentTask, title: e.target.value})}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white focus:border-indigo-500 outline-none"
                    required
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-400 uppercase mb-1.5 ml-1">الوصف</label>
                  <input 
                    type="text" 
                    value={currentTask.description}
                    onChange={e => setCurrentTask({...currentTask, description: e.target.value})}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white focus:border-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase mb-1.5 ml-1">المكافأة</label>
                  <input 
                    type="number" 
                    value={currentTask.reward_coins}
                    onChange={e => setCurrentTask({...currentTask, reward_coins: parseInt(e.target.value)})}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white focus:border-indigo-500 outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase mb-1.5 ml-1">الأيقونة</label>
                  <input 
                    type="text" 
                    value={currentTask.icon_name}
                    onChange={e => setCurrentTask({...currentTask, icon_name: e.target.value})}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white focus:border-indigo-500 outline-none"
                    placeholder="Twitter, Youtube..."
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-400 uppercase mb-1.5 ml-1">الرابط</label>
                  <input 
                    type="url" 
                    value={currentTask.link || ''}
                    onChange={e => setCurrentTask({...currentTask, link: e.target.value})}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white focus:border-indigo-500 outline-none"
                  />
                </div>
                <div className="col-span-2 flex items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setCurrentTask(prev => ({...prev, is_active: !prev.is_active}))}
                    className={`w-12 h-6 rounded-full transition-colors relative ${currentTask.is_active ? 'bg-emerald-500' : 'bg-slate-700'}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${currentTask.is_active ? 'left-7' : 'left-1'}`} />
                  </button>
                  <span className="text-sm font-medium text-slate-300">المهمة نشطة وظاهرة للمستخدمين</span>
                </div>
              </div>

              <div className="pt-4 flex gap-3">
                <button 
                  type="button"
                  onClick={() => setIsEditingTask(false)}
                  className="flex-1 py-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-medium transition-colors"
                >
                  إلغاء
                </button>
                <button 
                  type="submit"
                  disabled={actionLoading === 'saveTask'}
                  className="flex-1 py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold shadow-lg shadow-indigo-600/25 transition-all flex justify-center items-center gap-2"
                >
                  {actionLoading === 'saveTask' ? <Loader2 className="animate-spin" size={20}/> : 'حفظ التغييرات'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
