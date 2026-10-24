require('dotenv').config()
const postgres = require('postgres')

const supabaseUrl = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

// Extract connection details from Supabase URL
// URL format: https://project-id.supabase.co
const projectId = supabaseUrl.split('//')[1].split('.')[0]

// Connect to Supabase PostgreSQL using service role key
// Format: postgres://postgres:[service_key]@db.supabase.co:5432/postgres
const connectionString = `postgres://postgres:${serviceRoleKey}@db.${projectId}.supabase.co:5432/postgres`

async function createTables() {
  let sql

  try {
    console.log('🔄 Connecting to Supabase PostgreSQL...')
    console.log(`📌 Project: ${projectId}\n`)

    sql = postgres(connectionString, {
      ssl: 'require'
    })

    console.log('✅ Connected!\n')
    console.log('📝 Creating tables...\n')

    // Create users table
    await sql`
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
      )
    `
    console.log('   ✅ users table created')

    // Create index on users
    await sql`
      CREATE INDEX IF NOT EXISTS users_subscription_expiry 
      ON users(subscription_expiry) 
      WHERE subscription_tier != 'lifetime' AND subscription_tier != 'free'
    `
    console.log('   ✅ users index created')

    // Create payments table
    await sql`
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
      )
    `
    console.log('   ✅ payments table created')

    // Create indexes on payments
    await sql`CREATE INDEX IF NOT EXISTS payments_user_id ON payments(user_id)`
    await sql`CREATE INDEX IF NOT EXISTS payments_created_at ON payments(created_at DESC)`
    await sql`CREATE INDEX IF NOT EXISTS payments_status ON payments(status)`
    console.log('   ✅ payments indexes created')

    console.log('\n✨ All tables created successfully!\n')
    console.log('📊 Schema:')
    console.log('   • users table (subscription tracking)')
    console.log('   • payments table (transaction audit)')
    console.log('   • 4 indexes for fast queries')
    console.log('\n🎉 Ready to test!')

    await sql.end()
    process.exit(0)
  } catch (err) {
    console.error('❌ Error:', err.message)
    console.error('\nDebugging info:')
    console.error(`   Project ID: ${projectId}`)
    console.error(`   Connection String: postgres://postgres:***@db.${projectId}.supabase.co:5432/postgres`)

    if (err.message.includes('ENOTFOUND')) {
      console.error('\n⚠️  DNS resolution failed. Check your internet connection.')
    } else if (err.message.includes('password')) {
      console.error('\n⚠️  Authentication failed. Check SUPABASE_SERVICE_ROLE_KEY')
    } else if (err.message.includes('already exists')) {
      console.error('\n⚠️  Tables already exist (this is OK)')
    }

    if (sql) await sql.end()
    process.exit(1)
  }
}

createTables()
