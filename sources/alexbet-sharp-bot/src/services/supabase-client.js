/**
 * Supabase Client Service
 * Handles all database operations for AlexBET Sharp Bot
 * 
 * Schema:
 * - users: user_id, subscription_tier, subscription_expiry, payment_method
 * - payments: audit trail of all transactions
 */

const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  logger.warn('⚠️ Supabase credentials not configured - subscriptions will not persist on restart');
}

const supabase = supabaseUrl && supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey)
  : null;

// =====================
// USER OPERATIONS
// =====================

/**
 * Get user subscription info
 * @param {number} userId - Telegram user ID
 * @returns {Promise<{data, error}>}
 */
async function getUser(userId) {
  if (!supabase) return { data: null, error: 'Supabase not configured' };
  
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();
    
    return { data, error };
  } catch (err) {
    logger.error('Error fetching user:', { userId, error: err.message });
    return { data: null, error: err };
  }
}

/**
 * Create or update user
 * @param {number} userId - Telegram user ID
 * @param {string} username - Telegram username
 * @returns {Promise<{data, error}>}
 */
async function upsertUser(userId, username) {
  if (!supabase) return { data: null, error: 'Supabase not configured' };
  
  try {
    const { data, error } = await supabase
      .from('users')
      .upsert(
        {
          id: userId,
          username,
          updated_at: new Date()
        },
        { onConflict: 'id' }
      )
      .select()
      .single();
    
    return { data, error };
  } catch (err) {
    logger.error('Error upserting user:', { userId, error: err.message });
    return { data: null, error: err };
  }
}

/**
 * Add subscription to user
 * @param {number} userId - Telegram user ID
 * @param {string} tier - 'monthly', 'yearly', or 'lifetime'
 * @param {string} paymentMethod - 'telegram_stars' or 'whop'
 * @returns {Promise<{data, error}>}
 */
async function addSubscription(userId, tier, paymentMethod = 'telegram_stars') {
  if (!supabase) return { data: null, error: 'Supabase not configured' };
  
  try {
    // Calculate expiry date based on tier
    const now = new Date();
    let expiryDate = null;
    
    if (tier === 'monthly') {
      expiryDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    } else if (tier === 'yearly') {
      expiryDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    }
    // lifetime: expiryDate stays null
    
    const { data, error } = await supabase
      .from('users')
      .update({
        subscription_tier: tier,
        subscription_expiry: expiryDate,
        last_payment_date: now,
        payment_method: paymentMethod,
        updated_at: now
      })
      .eq('id', userId)
      .select()
      .single();
    
    return { data, error };
  } catch (err) {
    logger.error('Error adding subscription:', { userId, tier, error: err.message });
    return { data: null, error: err };
  }
}

/**
 * Check if user subscription is active
 * @param {number} userId - Telegram user ID
 * @returns {Promise<boolean>}
 */
async function isSubscriptionActive(userId) {
  try {
    const { data, error } = await getUser(userId);
    
    if (error || !data) return false;
    
    // Lifetime subscriptions never expire
    if (data.subscription_tier === 'lifetime') return true;
    
    // Check if subscription_expiry is in the future
    if (data.subscription_expiry) {
      return new Date(data.subscription_expiry) > new Date();
    }
    
    return false;
  } catch (err) {
    logger.error('Error checking subscription:', { userId, error: err.message });
    return false;
  }
}

/**
 * Get subscription tier for user
 * @param {number} userId - Telegram user ID
 * @returns {Promise<string>} - 'free', 'monthly', 'yearly', or 'lifetime'
 */
async function getSubscriptionTier(userId) {
  try {
    const { data } = await getUser(userId);
    
    if (!data) return 'free';
    
    // Check if tier is still active
    if (await isSubscriptionActive(userId)) {
      return data.subscription_tier || 'free';
    }
    
    return 'free';
  } catch (err) {
    logger.error('Error getting subscription tier:', { userId, error: err.message });
    return 'free';
  }
}

/**
 * Revoke subscription (mark as expired)
 * @param {number} userId - Telegram user ID
 * @returns {Promise<{data, error}>}
 */
async function revokeSubscription(userId) {
  if (!supabase) return { data: null, error: 'Supabase not configured' };
  
  try {
    const { data, error } = await supabase
      .from('users')
      .update({
        subscription_tier: 'free',
        subscription_expiry: new Date(),
        updated_at: new Date()
      })
      .eq('id', userId)
      .select()
      .single();
    
    return { data, error };
  } catch (err) {
    logger.error('Error revoking subscription:', { userId, error: err.message });
    return { data: null, error: err };
  }
}

// =====================
// PAYMENT LOGGING
// =====================

/**
 * Log payment transaction
 * @param {object} paymentData - { user_id, amount_stars, tier, status, payment_method, telegram_charge_id }
 * @returns {Promise<{data, error}>}
 */
async function logPayment(paymentData) {
  if (!supabase) return { data: null, error: 'Supabase not configured' };
  
  try {
    const { data, error } = await supabase
      .from('payments')
      .insert([
        {
          user_id: paymentData.user_id,
          amount_stars: paymentData.amount_stars,
          tier: paymentData.tier,
          status: paymentData.status || 'pending',
          payment_method: paymentData.payment_method || 'telegram_stars',
          telegram_charge_id: paymentData.telegram_charge_id
        }
      ])
      .select()
      .single();
    
    return { data, error };
  } catch (err) {
    logger.error('Error logging payment:', { userId: paymentData.user_id, error: err.message });
    return { data: null, error: err };
  }
}

/**
 * Get user payment history
 * @param {number} userId - Telegram user ID
 * @returns {Promise<{data, error}>}
 */
async function getPaymentHistory(userId, limit = 10) {
  if (!supabase) return { data: null, error: 'Supabase not configured' };
  
  try {
    const { data, error } = await supabase
      .from('payments')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    
    return { data, error };
  } catch (err) {
    logger.error('Error fetching payment history:', { userId, error: err.message });
    return { data: null, error: err };
  }
}

// =====================
// CLEANUP (Cron Job)
// =====================

/**
 * Clean up expired subscriptions
 * Called hourly by cron job
 * @returns {Promise<{deleted_count, error}>}
 */
async function cleanupExpiredSubscriptions() {
  if (!supabase) return { deleted_count: 0, error: 'Supabase not configured' };
  
  try {
    const now = new Date();
    
    // Find and count expired subscriptions
    const { data: expiredUsers, error: fetchError } = await supabase
      .from('users')
      .select('id')
      .eq('subscription_tier', 'lifetime')
      .not('subscription_tier', 'eq', 'lifetime')  // Only non-lifetime
      .lt('subscription_expiry', now.toISOString());
    
    if (fetchError) throw fetchError;
    
    const count = expiredUsers?.length || 0;
    
    if (count > 0) {
      // Batch update expired users to free tier
      const expiredIds = expiredUsers.map(u => u.id);
      
      const { error: updateError } = await supabase
        .from('users')
        .update({
          subscription_tier: 'free',
          updated_at: now
        })
        .in('id', expiredIds);
      
      if (updateError) throw updateError;
      
      logger.info('Cleaned up expired subscriptions', { count });
    }
    
    return { deleted_count: count, error: null };
  } catch (err) {
    logger.error('Error cleaning up subscriptions:', err.message);
    return { deleted_count: 0, error: err };
  }
}

// =====================
// INITIALIZATION
// =====================

/**
 * Initialize Supabase tables (run once)
 * Creates users and payments tables if they don't exist
 */
async function initializeTables() {
  if (!supabase) {
    logger.warn('Supabase not configured - skipping table initialization');
    return;
  }
  
  try {
    // Tables are typically created via Supabase dashboard or migrations
    // This is just a verification step
    const { data: tableCheck } = await supabase
      .from('users')
      .select('count')
      .limit(1);
    
    logger.info('✅ Supabase tables verified');
  } catch (err) {
    logger.warn('⚠️ Supabase tables may not exist:', err.message);
    logger.info('Please create tables via Supabase dashboard or migration');
  }
}

// Export all functions
module.exports = {
  supabase,
  // User operations
  getUser,
  upsertUser,
  addSubscription,
  isSubscriptionActive,
  getSubscriptionTier,
  revokeSubscription,
  // Payment logging
  logPayment,
  getPaymentHistory,
  // Cleanup
  cleanupExpiredSubscriptions,
  // Initialization
  initializeTables
};
