// lib/gameState.ts

export interface GameStateData {
  // الحالة المحلية (Optimistic)
  localCoins: number;
  localEnergy: number;
  maxEnergy: number;
  
  // حالة السيرفر
  serverCoins: number;
  serverEnergy: number;
  
  // المضاعف
  multiplier: number;
  multiplierEndTime: number;
  
  // البوت
  botActiveUntil: number;
  
  // الإحصائيات
  pendingTaps: number;
  lastSyncTime: number;
  isSyncing: boolean;
}

class GameStateManager {
  private state: GameStateData = {
    localCoins: 0,
    localEnergy: 500,
    maxEnergy: 500,
    serverCoins: 0,
    serverEnergy: 500,
    multiplier: 1,
    multiplierEndTime: 0,
    botActiveUntil: 0,
    pendingTaps: 0,
    lastSyncTime: Date.now(),
    isSyncing: false
  };

  private syncTimer: NodeJS.Timeout | null = null;
  private syncInterval = 2000; // مزامنة كل ثانيتين
  private maxBatchSize = 20; // تجميع 20 ضغطة كحد أقصى
  private listeners: (() => void)[] = [];

  constructor() {
    // بدء المزامنة الدورية
    this.startPeriodicSync();
  }

  // تحديث الحالة من السيرفر
  setServerState(data: {
    coins: number;
    energy: number;
    maxEnergy: number;
    multiplier: number;
    multiplierEndTime: number;
    botActiveUntil: number;
  }) {
    this.state.serverCoins = data.coins;
    this.state.serverEnergy = data.energy;
    this.state.maxEnergy = data.maxEnergy;
    this.state.multiplier = data.multiplier;
    this.state.multiplierEndTime = data.multiplierEndTime;
    this.state.botActiveUntil = data.botActiveUntil;
    
    // تنعيم الانتقال
    this.state.localCoins = data.coins;
    this.state.localEnergy = data.energy;
    
    this.notifyListeners();
  }

  // إضافة ضغطة واحدة
  addTap(): { success: boolean; earned: number } {
    const now = Date.now();
    
    // التحقق من الطاقة
    if (this.state.localEnergy < 1) {
      return { success: false, earned: 0 };
    }

    // حساب المكسب (مع المضاعف)
    const isMultiplierActive = this.state.multiplierEndTime > now;
    const earned = isMultiplierActive ? this.state.multiplier : 1;

    // تحديث محلي فوري
    this.state.localCoins += earned;
    this.state.localEnergy -= 1;
    this.state.pendingTaps += 1;

    // مزامنة إذا وصلنا للحد الأقصى
    if (this.state.pendingTaps >= this.maxBatchSize) {
      this.syncWithServer();
    }

    this.notifyListeners();
    return { success: true, earned };
  }

  // إضافة ضغطات من البوت
  addBotTaps(amount: number) {
    const now = Date.now();
    if (this.state.botActiveUntil <= now) return;

    // البوت يضيف ضغطات ولكن لا يستهلك طاقة
    const isMultiplierActive = this.state.multiplierEndTime > now;
    const earned = amount * (isMultiplierActive ? this.state.multiplier : 1);

    this.state.localCoins += earned;
    this.state.pendingTaps += amount;
    
    this.notifyListeners();
  }

  // المزامنة مع السيرفر
  private async syncWithServer() {
    if (this.state.isSyncing || this.state.pendingTaps === 0) return;

    this.state.isSyncing = true;
    const tapsToSend = this.state.pendingTaps;
    this.state.pendingTaps = 0;

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

      if (!response.ok) throw new Error('Sync failed');

      const data = await response.json();
      
      // تحديث بقيم السيرفر
      this.state.serverCoins = data.user.coins;
      this.state.serverEnergy = data.user.energy;
      this.state.maxEnergy = data.user.max_energy;
      this.state.multiplier = data.user.tap_multiplier;
      this.state.multiplierEndTime = data.user.tap_multiplier_end_time;
      this.state.botActiveUntil = data.user.auto_bot_active_until;
      
      // تصحيح القيم المحلية إذا كان هناك فرق كبير
      if (Math.abs(this.state.localCoins - this.state.serverCoins) > 100) {
        this.state.localCoins = this.state.serverCoins;
      }
      if (Math.abs(this.state.localEnergy - this.state.serverEnergy) > 10) {
        this.state.localEnergy = this.state.serverEnergy;
      }

    } catch (error) {
      console.error('Sync failed, restoring taps:', error);
      this.state.pendingTaps += tapsToSend;
    } finally {
      this.state.isSyncing = false;
      this.state.lastSyncTime = Date.now();
      this.notifyListeners();
    }
  }

  private startPeriodicSync() {
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = setInterval(() => {
      if (this.state.pendingTaps > 0) {
        this.syncWithServer();
      }
    }, this.syncInterval);
  }

  // مشاهدة إعلان المضاعف (x4)
  watchMultiplierAd() {
    this.state.multiplier = 4;
    this.state.multiplierEndTime = Date.now() + 300000; // 5 دقائق
    this.notifyListeners();
  }

  // مشاهدة إعلان الطاقة
  watchEnergyAd() {
    this.state.localEnergy = this.state.maxEnergy;
    this.notifyListeners();
  }

  // مشاهدة إعلان البوت
  watchBotAd() {
    this.state.botActiveUntil = Date.now() + 21600000; // 6 ساعات
    this.notifyListeners();
  }

  // الاستماع للتحديثات
  subscribe(listener: () => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notifyListeners() {
    this.listeners.forEach(l => l());
  }

  // الحصول على الحالة للعرض
  getDisplayState() {
    return {
      coins: this.state.localCoins,
      energy: this.state.localEnergy,
      maxEnergy: this.state.maxEnergy,
      multiplier: this.state.multiplier,
      multiplierEndTime: this.state.multiplierEndTime,
      botActiveUntil: this.state.botActiveUntil,
      isSyncing: this.state.isSyncing,
      pendingTaps: this.state.pendingTaps
    };
  }

  // التنظيف
  destroy() {
    if (this.syncTimer) clearInterval(this.syncTimer);
  }
}

// تصدير نسخة واحدة فقط (Singleton)
export const gameState = new GameStateManager();
