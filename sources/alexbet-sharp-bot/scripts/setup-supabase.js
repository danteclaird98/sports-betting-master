require('dotenv').config()
const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function setupTables() {
  try {
    console.log('🔄 Setting up Supabase tables...\n')

    // Create users table
    console.log('📝 Creating users table...')
    const { error: usersError } = await supabase
      .from('users')
      .select('count')
      .limit(1)
      .catch(() => ({ error: { message: 'Table does not exist' } }))

    if (usersError && usersError.message.includes('does not exist')) {
      // Table doesn't exist, we need to create it
      console.log('   ℹ️  Users table needs to be created via SQL')
    } else {
      console.log('   ✅ Users table exists')
    }

    // Create payments table
    console.log('📝 Creating payments table...')
    const { error: paymentsError } = await supabase
      .from('payments')
      .select('count')
      .limit(1)
      .catch(() => ({ error: { message: 'Table does not exist' } }))

    if (paymentsError && paymentsError.message.includes('does not exist')) {
      console.log('   ℹ️  Payments table needs to be created via SQL')
    } else {
      console.log('   ✅ Payments table exists')
    }

    console.log('\n⚠️  Tables must be created via Supabase SQL Editor.')
    console.log('📋 Here\'s what to do:\n')
    console.log('1. Go to: https://app.supabase.com/')
    console.log('2. Select your project (nzhkfmepfcamrfioqwcr)')
    console.log('3. Click SQL Editor (left sidebar)')
    console.log('4. Create a new query')
    console.log('5. Copy this SQL:\n')

    const sql = `
-- Users Table
CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY,
  username TEXT,
  subscription_tier TEXT DEFAULT 'free',
  subscription_expiry TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_payment_date TIMESTAMP,
  payment_method TEXT,
  CHECK (subscription_tier IN ('free', 'monthly', 'yearly', 'lifetime'))
);

-- Payments Table
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  amount_stars INT,
  tier TEXT,
  status TEXT DEFAULT 'pending',
  payment_method TEXT,
  telegram_charge_id TEXT UNIQUE,
  created_at TIMESTAMP DEFAULT NOW(),
  CHECK (tier IN ('monthly', 'yearly', 'lifetime')),
  CHECK (status IN ('pending', 'completed', 'failed')),
  CHECK (payment_method IN ('telegram_stars', 'whop'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS users_subscription_expiry ON users(subscription_expiry);
CREATE INDEX IF NOT EXISTS payments_user_id ON payments(user_id);
CREATE INDEX IF NOT EXISTS payments_created_at ON payments(created_at DESC);
CREATE INDEX IF NOT EXISTS payments_status ON payments(status);
`

    console.log(sql)
    console.log('\n6. Click "Run"')
    console.log('7. Then run: node verify-supabase.js\n')

    return false
  } catch (err) {
    console.error('❌ Error:', err.message)
    return false
  }
}

setupTables().then(success => {
  process.exit(success ? 0 : 1)
})
