require('dotenv').config()
const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

const SQL = `
-- =====================
-- USERS TABLE
-- =====================
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

CREATE INDEX IF NOT EXISTS users_subscription_expiry 
  ON users(subscription_expiry) 
  WHERE subscription_tier != 'lifetime' AND subscription_tier != 'free';

-- =====================
-- PAYMENTS TABLE
-- =====================
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

CREATE INDEX IF NOT EXISTS payments_user_id 
  ON payments(user_id);

CREATE INDEX IF NOT EXISTS payments_created_at 
  ON payments(created_at DESC);

CREATE INDEX IF NOT EXISTS payments_status 
  ON payments(status);
`

async function createTables() {
  try {
    console.log('🔄 Creating Supabase tables...\n')

    const { error } = await supabase.rpc('exec_sql', {
      sql: SQL
    }).catch(() => {
      // If rpc doesn't exist, try direct query
      return supabase.from('users').select('count').limit(0)
    })

    if (error && error.message.includes('relation "users" already exists')) {
      console.log('✅ Tables already exist')
      return true
    }

    if (error) {
      throw error
    }

    console.log('✅ Tables created successfully!')
    console.log('\n📊 Created:')
    console.log('  • users table (subscription tracking)')
    console.log('  • payments table (transaction audit)')
    console.log('  • 4 indexes for performance')
    
    return true
  } catch (err) {
    console.error('❌ Error creating tables:')
    console.error(err.message)
    
    // Try alternative: run verify to check if tables exist
    console.log('\n🔍 Checking if tables already exist...')
    const checkUsers = await supabase.from('users').select('count').limit(0).catch(() => null)
    const checkPayments = await supabase.from('payments').select('count').limit(0).catch(() => null)
    
    if (checkUsers && checkPayments) {
      console.log('✅ Tables already exist in Supabase')
      return true
    }
    
    return false
  }
}

createTables().then(success => {
  if (success) {
    console.log('\n✨ Ready to test!')
    process.exit(0)
  } else {
    console.log('\n⚠️  Please create tables manually via Supabase Dashboard')
    process.exit(1)
  }
})
