// lib/gameState.ts
/**
 * نظام متطور لإدارة حالة اللعبة محلياً مع:
 * - تجميع الضغطات (Batching)
 * - مزامنة خلفية ذكية
 * - Anti-Cheat مدمج
 * - أداء عالي (60fps)
 */

export interface QueuedTap {
  timestamp: number;
  clientX: number;
  clientY: number;
  value: number;
}

export interface LocalGameState {
  // الحالة المحلية
  localCoins: number;
  localEnergy: number;
  pendingTaps: QueuedTap[];
  lastSyncTime: number;
  
  // إحصائيات
  totalTapsInSession: number;
  tapRate: number[]; // للكشف عن البوتات
  
  // حالة المزامنة
  isSyncing: boolean;
  syncErrors: number;
  lastServerCoins: number;
  lastServerEnergy: number;
}

class GameStateManager {
  private state: LocalGameState = {
    localCoins: 0,
    localEnergy: 0,
    pendingTaps: [],
    lastSyncTime: Date.now(),
    totalTapsInSession: 0,
    tapRate: [],
    isSyncing: false,
    syncErrors: 0,
    lastServerCoins: 0,
    lastServerEnergy: 0
  };

  private callbacks: {
    onStateChange?: (state: LocalGameState) => void;
    onSyncStart?: () => void;
    onSyncEnd?: (success: boolean) => void;
  } = {};

  private syncTimer: NodeJS.Timeout | null = null;
  private maxBatchSize = 50; // تجميع 50 ضغطة كحد أقصى
  private syncInterval = 2000; // مزامنة كل 2 ثانية
  private maxTapRate = 15; // 15 ضغطة/ثانية كحد أقصى للبشر

  constructor() {
    // بدء المزامنة الدورية
    this.startPeriodicSync();
  }

  // تعيين الـ Callbacks
  setCallbacks(callbacks: typeof this.callbacks) {
    this.callbacks = callbacks;
  }

  // إضافة ضغطة جديدة (Optimistic Update)
  addTap(x: number, y: number, multiplier: number = 1): boolean {
    const now = Date.now();
    
    // ✅ Anti-Cheat: فحص معدل الضغط
    this.updateTapRate();
    if (!this.checkTapRate()) {
      console.warn('[ANTI-CHEAT] Tap rate too high');
      return false;
    }

    // ✅ Anti-Cheat: فحص الطاقة
    if (this.state.localEnergy <= 0) {
      return false;
    }

    // إنشاء كائن الضغطة
    const tap: QueuedTap = {
      timestamp: now,
      clientX: Math.round(x),
      clientY: Math.round(y),
      value: multiplier
    };

    // إضافة للطابور
    this.state.pendingTaps.push(tap);
    
    // تحديث الحالة المحلية (Optimistic)
    this.state.localCoins += multiplier;
    this.state.localEnergy -= 1;
    this.state.totalTapsInSession += 1;

    // ✅ إذا وصلنا للحد الأقصى، نزامن فوراً
    if (this.state.pendingTaps.length >= this.maxBatchSize) {
      this.forceSync();
    }

    // إشعار المستمعين
    this.notifyStateChange();
    
    return true;
  }

  // تحديث معدل الضغط
  private updateTapRate() {
    const now = Date.now();
    // نحتفظ بآخر 10 ضغطات فقط
    this.state.tapRate = this.state.tapRate
      .filter(t => now - t < 1000)
      .concat([now]);
    
    if (this.state.tapRate.length > 10) {
      this.state.tapRate = this.state.tapRate.slice(-10);
    }
  }

  // فحص معدل الضغط (يمنع البوتات)
  private checkTapRate(): boolean {
    if (this.state.tapRate.length < 5) return true;
    
    // حساب التباين في التوقيتات (الروبوتات لها تباين منخفض جداً)
    const intervals = [];
    for (let i = 1; i < this.state.tapRate.length; i++) {
      intervals.push(this.state.tapRate[i] - this.state.tapRate[i-1]);
    }
    
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) / intervals.length;
    
    // ✅ البشر: variance عالي (> 100) ، البوتات: variance منخفض جداً
    if (variance < 50 && this.state.totalTapsInSession > 20) {
      return false; // يشتبه بأنه بوت
    }
    
    return this.state.tapRate.length <= this.maxTapRate;
  }

  // بدء المزامنة الدورية
  private startPeriodicSync() {
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = setInterval(() => {
      if (this.state.pendingTaps.length > 0) {
        this.syncWithServer();
      }
    }, this.syncInterval);
  }

  // إجبار المزامنة الفورية
  async forceSync() {
    if (this.state.pendingTaps.length === 0) return;
    await this.syncWithServer();
  }

  // المزامنة مع السيرفر
  private async syncWithServer() {
    if (this.state.isSyncing || this.state.pendingTaps.length === 0) return;

    this.state.isSyncing = true;
    this.callbacks.onSyncStart?.();

    const tapsToSend = [...this.state.pendingTaps];
    this.state.pendingTaps = []; // ننظف الطابور مؤقتاً

    try {
      const initData = window.Telegram?.WebApp?.initData;
      if (!initData) throw new Error('No init data');

      const response = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          initData,
          taps: tapsToSend,
          clientTime: Date.now()
        })
      });

      if (!response.ok) {
        throw new Error(`Sync failed: ${response.status}`);
      }

      const data = await response.json();
      
      // ✅ تحديث الحالة من السيرفر (الحقيقة المطلقة)
      this.state.localCoins = data.user.coins;
      this.state.localEnergy = data.user.energy;
      this.state.lastServerCoins = data.user.coins;
      this.state.lastServerEnergy = data.user.energy;
      this.state.lastSyncTime = Date.now();
      this.state.syncErrors = 0;

      this.callbacks.onSyncEnd?.(true);
      
    } catch (error) {
      console.error('Sync failed:', error);
      
      // في حالة الفشل، نعيد الضغطات للطابور
      this.state.pendingTaps = [...tapsToSend, ...this.state.pendingTaps];
      this.state.syncErrors++;
      
      // إذا فشلت 3 مرات متتالية، نزيد وقت المزامنة
      if (this.state.syncErrors >= 3) {
        this.syncInterval = 5000; // نبطئ المزامنة
        this.startPeriodicSync();
      }

      this.callbacks.onSyncEnd?.(false);
    } finally {
      this.state.isSyncing = false;
      this.notifyStateChange();
    }
  }

  // الحصول على الإحصائيات المعلقة
  getPendingStats() {
    const pendingCoins = this.state.pendingTaps.reduce((sum, tap) => sum + tap.value, 0);
    const pendingEnergy = this.state.pendingTaps.length;
    
    return {
      pendingCoins,
      pendingEnergy,
      totalPending: this.state.pendingTaps.length
    };
  }

  // الحصول على الحالة الكاملة
  getState() {
    return { ...this.state };
  }

  // تحديث الحالة من السيرفر (للتهيئة)
  setServerState(coins: number, energy: number, maxEnergy: number) {
    this.state.localCoins = coins;
    this.state.localEnergy = energy;
    this.state.lastServerCoins = coins;
    this.state.lastServerEnergy = energy;
    this.state.lastSyncTime = Date.now();
    this.notifyStateChange();
  }

  private notifyStateChange() {
    this.callbacks.onStateChange?.(this.getState());
  }

  // تنظيف
  destroy() {
    if (this.syncTimer) clearInterval(this.syncTimer);
  }
}

// ✅ Singleton instance
export const gameState = new GameStateManager();
