// lib/gameState.ts

export interface GameStateData {
  coins: number;
  energy: number;
  maxEnergy: number;
  multiplier: number;
  multiplierEndTime: number;
  botActiveUntil: number;
  pendingTaps: number;
  isSyncing: boolean;
}

class GameStateManager {
  private state: GameStateData = {
    coins: 0,
    energy: 500,
    maxEnergy: 500,
    multiplier: 1,
    multiplierEndTime: 0,
    botActiveUntil: 0,
    pendingTaps: 0,
    isSyncing: false
  };

  private listeners: (() => void)[] = [];
  private syncTimer: NodeJS.Timeout | null = null;
  
  // إعدادات الأداء (تحكم بها لتقليل ضغط الداتا بيز)
  private readonly SYNC_INTERVAL = 10000; // مزامنة كل 10 ثوانٍ (بدلاً من 2)
  private readonly MAX_PENDING = 50;      // إرسال فوراً إذا وصل لـ 50 ضغطة

  constructor() {
    if (typeof window !== 'undefined') {
      this.startRegeneration(); // بدء تجدد الطاقة تلقائياً
      this.startPeriodicSync();
      
      // حفظ البيانات عند إغلاق المتصفح/التطبيق
      window.addEventListener('beforeunload', () => this.forceSync());
      window.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.forceSync();
      });
    }
  }

  // تحديث الحالة القادمة من السيرفر (بعد الـ Auth أو الـ Sync)
  setServerState(data: any) {
    this.state = {
      ...this.state,
      coins: data.coins ?? this.state.coins,
      energy: data.energy ?? this.state.energy,
      maxEnergy: data.max_energy ?? 500,
      multiplier: data.tap_multiplier ?? 1,
      multiplierEndTime: data.tap_multiplier_end_time ?? 0,
      botActiveUntil: data.auto_bot_active_until ?? 0,
    };
    this.notify();
  }

  // منطق النقر (Optimistic Update)
  addTap(): { success: boolean; earned: number } {
    if (this.state.energy < 1) return { success: false, earned: 0 };

    const now = Date.now();
    const isMultiplierActive = this.state.multiplierEndTime > now;
    const earned = isMultiplierActive ? this.state.multiplier : 1;

    // تحديث محلي فوري (اللاعب يشعر بالسرعة)
    this.state.coins += earned;
    this.state.energy -= 1;
    this.state.pendingTaps += 1;

    // إذا وصل لـ 50 ضغطة، ارسل فوراً ولا تنتظر الـ 10 ثوانٍ
    if (this.state.pendingTaps >= this.MAX_PENDING) {
      this.syncWithServer();
    }

    this.notify();
    return { success: true, earned };
  }

  // تجدد الطاقة تلقائياً (1 طاقة كل ثانية)
  private startRegeneration() {
    setInterval(() => {
      if (this.state.energy < this.state.maxEnergy) {
        this.state.energy += 1;
        this.notify();
      }
    }, 1000);
  }

  private startPeriodicSync() {
    this.syncTimer = setInterval(() => this.syncWithServer(), this.SYNC_INTERVAL);
  }

  // المزامنة الفعلية مع السيرفر
  async syncWithServer() {
    if (this.state.isSyncing || this.state.pendingTaps === 0) return;

    const tapsToSend = this.state.pendingTaps;
    this.state.isSyncing = true;
    this.state.pendingTaps = 0; // تصفير مؤقت لمنع التكرار
    this.notify();

    try {
      const initData = window.Telegram?.WebApp?.initData;
      if (!initData) throw new Error("No Telegram InitData");

      const response = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData, taps: tapsToSend }),
        // keepalive يضمن وصول الطلب حتى لو أغلق المستخدم التطبيق فجأة
        keepalive: true 
      });

      if (response.ok) {
        const data = await response.json();
        // المزامنة مع قيم السيرفر الحقيقية (الـ Source of Truth)
        if (data.user) {
          this.state.coins = data.user.coins;
          this.state.energy = data.user.energy;
          this.state.multiplier = data.user.tap_multiplier;
          this.state.multiplierEndTime = data.user.tap_multiplier_end_time;
        }
      } else {
        throw new Error("Server Error");
      }
    } catch (error) {
      console.error("Sync Failed, rolling back taps:", error);
      this.state.pendingTaps += tapsToSend; // إعادة النقرات للمحاولة لاحقاً
    } finally {
      this.state.isSyncing = false;
      this.notify();
    }
  }

  forceSync() {
    this.syncWithServer();
  }

  // نظام الاشتراك لتحديث الواجهة (Subscribers)
  subscribe(listener: () => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notify() {
    this.listeners.forEach(l => l());
  }

  getDisplayState() {
    return { ...this.state };
  }
}

// تصدير نسخة واحدة (Singleton) لضمان عدم تضارب البيانات
export const gameState = new GameStateManager();
