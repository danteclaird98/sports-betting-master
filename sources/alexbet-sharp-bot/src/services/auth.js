/**
 * Authentication & Authorization Module
 * PHASE 2: Admin system + Subscription verification
 * 
 * Exports:
 * - isAdmin(userId)
 * - getSubscriptionDetails(userId)
 * - checkExportAccess(userId)
 * - checkScanAccess(userId)
 */

const logger = require('../utils/logger');
const { getSubscriptionDetails: whopGetSubscriptionDetails } = require('./whop-payment');

// ====================================
// ADMIN SYSTEM
// ====================================

const ADMIN_IDS = [8502906149]; // Jesse Collins

/**
 * Check if user is admin
 * Admins bypass ALL restrictions
 */
function isAdmin(userId) {
  const result = ADMIN_IDS.includes(userId);
  if (result) {
    logger.debug('Admin user detected', { userId });
  }
  return result;
}

// ====================================
// SUBSCRIPTION VERIFICATION
// ====================================

/**
 * Get complete subscription details
 * Handles both admins (unlimited) and regular users (Whop API)
 */
async function getSubscriptionDetails(userId) {
  try {
    // Admins get unlimited everything
    if (isAdmin(userId)) {
      logger.debug('Returning admin subscription', { userId });
      return {
        userId,
        isAdmin: true,
        tier: 'admin',
        status: 'active',
        gems: 9999,
        markets: ['moneyline', 'spreads', 'totals'],
        export: true,
        hasAccess: true
      };
    }

    // Non-admin: check Whop subscription
    logger.debug('Checking Whop subscription', { userId });
    const whopSub = await whopGetSubscriptionDetails(userId);
    
    return {
      userId,
      isAdmin: false,
      tier: whopSub.tier || 'free',
      status: whopSub.status || 'inactive',
      gems: whopSub.gems || 3,
      markets: whopSub.markets || ['moneyline'],
      export: whopSub.export || false,
      hasAccess: whopSub.status === 'active'
    };

  } catch (err) {
    logger.error('Failed to get subscription details', { userId, error: err.message });
    // Fail safe: return free tier
    return {
      userId,
      isAdmin: false,
      tier: 'free',
      status: 'error',
      gems: 3,
      markets: ['moneyline'],
      export: false,
      hasAccess: false
    };
  }
}

// ====================================
// ACCESS CONTROL FUNCTIONS
// ====================================

/**
 * Check if user can export
 */
async function checkExportAccess(userId) {
  if (isAdmin(userId)) {
    logger.debug('Export access granted (admin)', { userId });
    return { allowed: true, reason: 'admin' };
  }

  const sub = await getSubscriptionDetails(userId);
  
  if (!sub.export) {
    logger.info('Export access denied', { userId, tier: sub.tier });
    return {
      allowed: false,
      reason: 'premium_only',
      message: `Export is ${sub.tier === 'free' ? 'premium only' : 'not available for your tier'}`
    };
  }

  logger.debug('Export access granted', { userId, tier: sub.tier });
  return { allowed: true, reason: 'subscription', tier: sub.tier };
}

/**
 * Check if user can scan
 */
async function checkScanAccess(userId) {
  // Everyone can scan, but access levels differ
  if (isAdmin(userId)) {
    logger.debug('Scan access granted (admin)', { userId });
    return { allowed: true, gems: 9999, tier: 'admin' };
  }

  const sub = await getSubscriptionDetails(userId);
  logger.debug('Scan access granted', { userId, tier: sub.tier, gems: sub.gems });
  
  return {
    allowed: true,
    gems: sub.gems,
    markets: sub.markets,
    tier: sub.tier
  };
}

/**
 * Check if user can access specific market
 */
async function checkMarketAccess(userId, market) {
  if (isAdmin(userId)) {
    return true;
  }

  const sub = await getSubscriptionDetails(userId);
  const hasAccess = sub.markets.includes(market);
  
  logger.debug('Market access check', { userId, market, hasAccess });
  return hasAccess;
}

module.exports = {
  isAdmin,
  getSubscriptionDetails,
  checkExportAccess,
  checkScanAccess,
  checkMarketAccess,
  ADMIN_IDS
};
