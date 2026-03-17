-- Cloudflare D1 SQLite Schema for Tap to Earn Telegram Mini App

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    telegram_id TEXT UNIQUE NOT NULL,
    first_name TEXT,
    last_name TEXT,
    username TEXT,
    coins INTEGER DEFAULT 0,
    challenge_coins INTEGER DEFAULT 0,
    energy INTEGER DEFAULT 500,
    max_energy INTEGER DEFAULT 500,
    tap_multiplier INTEGER DEFAULT 1,
    tap_multiplier_end_time INTEGER DEFAULT 0,
    auto_bot_active_until INTEGER DEFAULT 0,
    ads_watched_today INTEGER DEFAULT 0,
    last_ad_watch_date TEXT,
    last_update_time INTEGER DEFAULT 0,
    total_taps INTEGER DEFAULT 0,
    wallet_connected INTEGER DEFAULT 0,
    wallet_address TEXT,
    referrals_count INTEGER DEFAULT 0,
    referrals_activated INTEGER DEFAULT 0,
    referral_coins_earned INTEGER DEFAULT 0,
    referred_by TEXT,
    completed_tasks TEXT DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    reward_coins INTEGER DEFAULT 0,
    link TEXT,
    icon_name TEXT,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ad_watches (
    id TEXT PRIMARY KEY,
    telegram_id TEXT NOT NULL,
    watched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (telegram_id) REFERENCES users(telegram_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS challenges (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    start_time INTEGER NOT NULL,
    end_time INTEGER NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Insert default tasks
INSERT OR IGNORE INTO tasks (id, title, description, reward_coins, link, icon_name) VALUES
('tg_channel', 'Join Telegram Channel', 'Get latest updates', 5000, 'https://t.me/yourchannel', 'MessageCircle'),
('x_follow', 'Follow on X', 'Follow us on X', 3000, 'https://x.com/youraccount', 'Twitter'),
('yt_sub', 'Subscribe YouTube', 'Watch our videos', 4000, 'https://youtube.com/@yourchannel', 'Youtube'),
('connect_wallet', 'Connect TON Wallet', 'Link your wallet', 5000, NULL, 'Wallet');

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_coins ON users(coins DESC);
CREATE INDEX IF NOT EXISTS idx_users_challenge_coins ON users(challenge_coins DESC);
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by);
CREATE INDEX IF NOT EXISTS idx_ad_watches_user_time ON ad_watches(telegram_id, watched_at DESC);

-- Migration (Safe to run if table already exists)
-- ALTER TABLE users ADD COLUMN challenge_coins INTEGER DEFAULT 0;
