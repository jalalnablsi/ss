-- ==========================================
-- TAP TO EARN - SUPABASE DATABASE SCHEMA
-- ==========================================

-- 1. Users Table
-- Stores core player data, balances, and wallet info.
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    telegram_id BIGINT UNIQUE NOT NULL,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    coins BIGINT DEFAULT 0,
    energy INT DEFAULT 500,
    max_energy INT DEFAULT 500,
    total_taps BIGINT DEFAULT 0,
    wallet_address TEXT UNIQUE, -- TON Wallet address
    is_banned BOOLEAN DEFAULT FALSE, -- Anti-cheat flag
    last_sync_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Referrals Table
-- Tracks who invited whom and the status of the referral.
CREATE TYPE referral_status AS ENUM ('pending', 'activated');

CREATE TABLE referrals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    referrer_id UUID REFERENCES users(id) ON DELETE CASCADE,
    referred_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    status referral_status DEFAULT 'pending',
    reward_claimed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast lookup of a user's referrals
CREATE INDEX idx_referrals_referrer ON referrals(referrer_id);

-- 3. Leaderboards (Weekly & Monthly)
-- Instead of calculating from scratch every time, we store periodic scores.
-- A cron job (pg_cron) or Edge Function resets these at the end of the period.
CREATE TABLE user_scores (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    weekly_score BIGINT DEFAULT 0,
    monthly_score BIGINT DEFAULT 0,
    all_time_score BIGINT DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_scores_weekly ON user_scores(weekly_score DESC);
CREATE INDEX idx_scores_monthly ON user_scores(monthly_score DESC);
CREATE INDEX idx_scores_all_time ON user_scores(all_time_score DESC);

-- 4. Tasks & Completed Tasks
CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    reward BIGINT NOT NULL,
    type TEXT NOT NULL, -- 'social', 'wallet', 'daily'
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE user_tasks (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
    completed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (user_id, task_id)
);

-- 5. Taps Log (For Anti-Cheat Analysis)
-- We don't store every single tap, but we store the batched syncs.
CREATE TABLE tap_sync_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    taps_added INT NOT NULL,
    client_timestamp BIGINT NOT NULL,
    server_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    signature TEXT -- To verify payload integrity
);

-- ==========================================
-- DATABASE FUNCTIONS & TRIGGERS
-- ==========================================

-- Trigger: When a user's total_taps reaches 500, activate their referral
CREATE OR REPLACE FUNCTION check_referral_activation()
RETURNS TRIGGER AS $$
BEGIN
    -- If the user just crossed the 500 taps threshold
    IF NEW.total_taps >= 500 AND OLD.total_taps < 500 THEN
        -- Update the referral status to activated
        UPDATE referrals 
        SET status = 'activated' 
        WHERE referred_id = NEW.id AND status = 'pending';
        
        -- Note: The actual reward (1500 coins) can be added here via trigger 
        -- or claimed manually by the referrer in the UI.
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_check_referral
AFTER UPDATE OF total_taps ON users
FOR EACH ROW
EXECUTE FUNCTION check_referral_activation();

-- Function: Reset Weekly Scores (Run via pg_cron every Monday at 00:00)
-- SELECT cron.schedule('0 0 * * 1', $$UPDATE user_scores SET weekly_score = 0$$);

-- Function: Reset Monthly Scores (Run via pg_cron on the 1st of every month)
-- SELECT cron.schedule('0 0 1 * *', $$UPDATE user_scores SET monthly_score = 0$$);
