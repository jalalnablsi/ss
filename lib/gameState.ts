// lib/gameState.ts
// نظام batching متقدم مع حماية من الغش

interface TapBatch {
  count: number;
  timestamp: number;
  sequence: number; // رقم تسلسلي للكشف عن التلاعب
}

interface QueuedTap {
  id: number;
  x: number;
  y: number;
  timestamp: number;
  processed: boolean;
}

class GameStateManager {
  private static instance: GameStateManager;
  
  // Batching
  private tapQueue: QueuedTap[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private readonly BATCH_SIZE = 30; // 30 ضغطة أو 500ms
  private readonly BATCH_TIMEOUT = 500;
  private sequenceNumber = 0;
  
  // Anti-Cheat Client-Side
  private lastTapTime = 0;
  private readonly MIN_TAP_INTERVAL = 50; // 50ms بين كل ضغطة (20 tap/sec max)
  private tapTimestamps: number[] = []; // تاريخ آخر 20 ضغطة للتحليل
  
  // State
  private pendingCoins = 0;
  private pendingEnergy = 0;
  private isSyncing = false;
  private syncPromise: Promise<any> | null = null;

  // Callbacks
  private onStateChange: ((state: LocalGameState) => void) | null = null;
  private onSyncStart: (() => void) | null = null;
  private onSyncEnd: ((success: boolean) => void) | null = null;

  private constructor() {}

  static getInstance() {
    if (!GameStateManager.instance) {
      GameStateManager.instance = new GameStateManager();
    }
    return GameStateManager.instance;
  }

  setCallbacks(callbacks: {
    onStateChange?: (state: LocalGameState) => void;
    onSyncStart?: () => void;
    onSyncEnd?: (success: boolean) => void;
  }) {
    this.onStateChange = callbacks.onStateChange || null;
    this.onSyncStart = callbacks.onSyncStart || null;
    this.onSyncEnd = callbacks.onSyncEnd || null;
  }

  // Anti-Cheat: التحقق من سرعة الضغط
  private checkTapRate(): boolean {
    const now = Date.now();
    
    // فحص الفاصل الزمني بين الضغطات
    if (now - this.lastTapTime < this.MIN_TAP_INTERVAL) {
      return false; // ضغطة سريعة جداً (غش محتمل)
    }
    
    this.lastTapTime = now;
    
    // فحص نمط الضغطات (Bot Detection بسيط)
    this.tapTimestamps.push(now);
    if (this.tapTimestamps.length > 20) {
      this.tapTimestamps.shift();
    }
    
    // إذا كانت الضغطات متساوية تماماً (±5ms) فهذا بوت
    if (this.tapTimestamps.length >= 10) {
      const intervals = [];
      for (let i = 1; i < this.tapTimestamps.length; i++) {
        intervals.push(this.tapTimestamps[i] - this.tapTimestamps[i-1]);
      }
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const variance = intervals.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) / intervals.length;
      
      // Variance منخفضة جداً = نمط روبوتي
      if (variance < 100) {
        console.warn('[ANTI-CHEAT] Robot pattern detected');
        return false;
      }
    }
    
    return true;
  }

  addTap(x: number, y: number, currentMultiplier: number): boolean {
    // فحص الأمان أولاً
    if (!this.checkTapRate()) {
      return false;
    }

    const now = Date.now();
    this.sequenceNumber++;

    const tap: QueuedTap = {
      id: this.sequenceNumber,
      x,
      y,
      timestamp: now,
      processed: false
    };

    this.tapQueue.push(tap);
    this.pendingCoins += currentMultiplier;
    this.pendingEnergy += 1;

    // تحديث فوري للـ UI
    this.notifyStateChange();

    // جدولة الـ Sync
    this.scheduleBatch();

    return true;
  }

  private scheduleBatch() {
    if (this.batchTimer) return;

    // Sync فوري إذا وصلنا للحد
    if (this.tapQueue.length >= this.BATCH_SIZE) {
      this.flushBatch();
      return;
    }

    this.batchTimer = setTimeout(() => {
      this.flushBatch();
    }, this.BATCH_TIMEOUT);
  }

  private async flushBatch() {
    if (this.tapQueue.length === 0 || this.isSyncing) return;

    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    const batchToSend = [...this.tapQueue];
    const coinsToSend = this.pendingCoins;
    const energyToSend = this.pendingEnergy;
    
    // Reset immediately لمنع الـ race condition
    this.tapQueue = [];
    this.pendingCoins = 0;
    this.pendingEnergy = 0;

    this.isSyncing = true;
    this.onSyncStart?.();

    try {
      // إرسال Batch واحد بدلاً من requests متعددة
      const result = await this.sendBatchToServer(batchToSend, coinsToSend, energyToSend);
      
      this.onSyncEnd?.(true);
      this.notifyStateChange();
      
      return result;
    } catch (error) {
      // إعادة المحاولة مرة واحدة فقط
      console.error('[SYNC] Failed, retrying once...', error);
      
      try {
        const result = await this.sendBatchToServer(batchToSend, coinsToSend, energyToSend);
        this.onSyncEnd?.(true);
        return result;
      } catch (retryError) {
        // فشلت المحاولة الثانية - استعادة الـ queue للـ next sync
        this.tapQueue.unshift(...batchToSend);
        this.pendingCoins += coinsToSend;
        this.pendingEnergy += energyToSend;
        this.onSyncEnd?.(false);
        console.error('[SYNC] Retry failed', retryError);
      }
    } finally {
      this.isSyncing = false;
    }
  }

  private async sendBatchToServer(taps: QueuedTap[], coins: number, energy: number) {
    const initData = window.Telegram?.WebApp?.initData;
    
    if (!initData) {
      throw new Error('No Telegram initData');
    }

    const response = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        initData,
        batch: {
          taps: taps.length,
          coins: coins,
          energy: energy,
          timestamps: taps.map(t => t.timestamp),
          sequence: this.sequenceNumber
        }
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Sync failed');
    }

    return response.json();
  }

  forceSync(): Promise<any> | null {
    if (this.tapQueue.length > 0) {
      return this.flushBatch();
    }
    return Promise.resolve(null);
  }

  getPendingStats() {
    return {
      pendingTaps: this.tapQueue.length,
      pendingCoins: this.pendingCoins,
      pendingEnergy: this.pendingEnergy,
      isSyncing: this.isSyncing
    };
  }

  private notifyStateChange() {
    this.onStateChange?.({
      pendingTaps: this.tapQueue.length,
      pendingCoins: this.pendingCoins,
      pendingEnergy: this.pendingEnergy,
      isSyncing: this.isSyncing
    });
  }
}

interface LocalGameState {
  pendingTaps: number;
  pendingCoins: number;
  pendingEnergy: number;
  isSyncing: boolean;
}

export const gameState = GameStateManager.getInstance();
export type { LocalGameState };
