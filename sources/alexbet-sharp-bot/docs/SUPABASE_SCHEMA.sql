-- AlexBET Sharp Bot Supabase Schema
-- Run these SQL queries in Supabase Dashboard → SQL Editor

-- =====================
-- USERS TABLE
-- =====================
-- Stores user subscription info
CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY,                    -- Telegram user ID
  username TEXT,                             -- Telegram username
  subscription_tier TEXT DEFAULT 'free',     -- 'free', 'monthly', 'yearly', 'lifetime'
  subscription_expiry TIMESTAMP,             -- When tier expires (NULL for lifetime)
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_payment_date TIMESTAMP,
  payment_method TEXT,                       -- 'telegram_stars' or 'whop'
  
  CHECK (subscription_tier IN ('free', 'monthly', 'yearly', 'lifetime'))
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS users_subscription_expiry 
  ON users(subscription_expiry) 
  WHERE subscription_tier != 'lifetime' AND subscription_tier != 'free';

-- =====================
-- PAYMENTS TABLE
-- =====================
-- Audit trail for all transactions
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  amount_stars INT,                         -- e.g., 999 for $9.99
  tier TEXT,                                 -- 'monthly', 'yearly', 'lifetime'
  status TEXT DEFAULT 'pending',             -- 'pending', 'completed', 'failed'
  payment_method TEXT,                       -- 'telegram_stars', 'whop'
  telegram_charge_id TEXT UNIQUE,           -- Telegram payment ID
  created_at TIMESTAMP DEFAULT NOW(),
  
  CHECK (tier IN ('monthly', 'yearly', 'lifetime')),
  CHECK (status IN ('pending', 'completed', 'failed')),
  CHECK (payment_method IN ('telegram_stars', 'whop'))
);

-- Index for payment lookups
CREATE INDEX IF NOT EXISTS payments_user_id 
  ON payments(user_id);

CREATE INDEX IF NOT EXISTS payments_created_at 
  ON payments(created_at DESC);

CREATE INDEX IF NOT EXISTS payments_status 
  ON payments(status);

-- =====================
-- ROW LEVEL SECURITY
-- =====================
-- (Optional) Protect user data - uncomment if needed

-- ALTER TABLE users ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- -- Allow users to see only their own data
-- CREATE POLICY "Users can view their own data"
--   ON users FOR SELECT
--   USING (auth.uid()::bigint = id);

-- CREATE POLICY "Users can view their own payments"
--   ON payments FOR SELECT
--   USING (auth.uid()::bigint = user_id);

-- =====================
-- USEFUL QUERIES
-- =====================

-- Check active subscriptions (use in queries)
-- SELECT * FROM users 
-- WHERE subscription_tier != 'free' 
-- AND (subscription_tier = 'lifetime' OR subscription_expiry > NOW());

-- Find expired subscriptions
-- SELECT id, username, subscription_expiry FROM users
-- WHERE subscription_tier != 'free'
-- AND subscription_tier != 'lifetime'
-- AND subscription_expiry < NOW();

-- Get payment summary for a user
-- SELECT * FROM payments
-- WHERE user_id = 123456
-- ORDER BY created_at DESC;

-- Count active subscriptions by tier
-- SELECT 
--   subscription_tier,
--   COUNT(*) as count,
--   MAX(last_payment_date) as latest_payment
-- FROM users
-- WHERE subscription_tier IN ('monthly', 'yearly', 'lifetime')
-- AND (subscription_tier = 'lifetime' OR subscription_expiry > NOW())
-- GROUP BY subscription_tier;
