/**
 * Tier Management Service
 * Handles user tier logic, limits, and feature access
 */

const logger = require('../utils/logger');
const { getTier, hasFeature, getScanLimit, getDaysRemaining, isSubscriptionActive } = require('./tiers');

/**
 * Check if user can perform action based on tier
 * @param {Object} user - User object with subscription
 * @param {string} action - Action to check (e.g., 'claude_analysis', 'export_csv')
 * @returns {Object} {allowed: boolean, reason?: string}
 */
function canUserPerformAction(user, action) {
  // Check subscription
  if (!user.subscription || !isSubscriptionActive(user.subscription)) {
    return { allowed: false, reason: 'Subscription not active' };
  }

  const tierId = user.subscription.tier_id || 'free';
  
  // Check feature access
  if (!hasFeature(tierId, action)) {
    return {
      allowed: false,
      reason: `Feature '${action}' not available in ${tierId} tier`,
      upgrade_url: 'https://alexbet.io/upgrade'
    };
  }

  logger.debug('Action allowed', { userId: user.id, tierId, action });
  return { allowed: true };
}

/**
 * Check if user has reached scan limit today
 * @param {Object} user - User object
 * @param {number} scansUsedToday - Number of scans used today
 * @returns {Object} {allowed: boolean, remaining?: number}
 */
function canUserScan(user, scansUsedToday) {
  if (!user.subscription) {
    return { allowed: false, reason: 'No subscription found' };
  }

  const tierId = user.subscription.tier_id || 'free';
  const limit = getScanLimit(tierId);

  if (limit === Infinity) {
    return { allowed: true, remaining: Infinity };
  }

  const remaining = Math.max(0, limit - scansUsedToday);
  const allowed = scansUsedToday < limit;

  if (!allowed) {
    logger.warn('Scan limit exceeded', {
      userId: user.id,
      tierId,
      limit,
      used: scansUsedToday
    });
  }

  return { allowed, remaining, limit };
}

/**
 * Get user's available Claude models
 * @param {Object} user - User object
 * @returns {Array<string>} Available Claude models
 */
function getUserClaudeModels(user) {
  if (!user.subscription) {
    return [];
  }

  const tierId = user.subscription.tier_id || 'free';

  // Map tiers to Claude models
  const modelMap = {
    free: [],
    sharp: ['claude-3-haiku-20240307'],
    elite: ['claude-3-haiku-20240307', 'claude-3-sonnet-20240229'],
    enterprise: ['claude-3-haiku-20240307', 'claude-3-sonnet-20240229', 'claude-3-opus-20240229']
  };

  return modelMap[tierId] || [];
}

/**
 * Format tier info for user display
 * @param {Object} subscription - Subscription object
 * @returns {string} Formatted tier info
 */
function formatTierInfo(subscription) {
  if (!subscription) {
    return '📱 Free Tier - Upgrade to unlock more features';
  }

  const tier = getTier(subscription.tier_id);
  const daysRemaining = getDaysRemaining(subscription);

  let info = `💎 ${tier.name} Tier`;

  if (subscription.on_trial) {
    info += ` (Trial)`;
  }

  if (daysRemaining !== null && daysRemaining > 0) {
    info += ` - ${daysRemaining} days remaining`;
  }

  if (subscription.status !== 'active') {
    info += ` [${subscription.status.toUpperCase()}]`;
  }

  return info;
}

/**
 * Generate tier comparison message
 * @param {string} currentTierId - User's current tier
 * @returns {string} Formatted comparison
 */
function generateUpgradeMessage(currentTierId) {
  const current = getTier(currentTierId);
  
  let message = `
💎 *AlexBET Tier Comparison*

Your Current: *${current.name}* ($${current.price}/mo)

*Available Upgrades:*
`;

  const allTiers = Object.keys(require('./tiers').TIERS);
  allTiers.forEach(tierKey => {
    if (tierKey === currentTierId.toUpperCase()) return;
    
    const tier = getTier(tierKey);
    message += `\n🔸 *${tier.name}* - $${tier.price}/mo\n`;
    message += `   ${tier.description}\n`;
  });

  message += `\n📖 Compare features: https://alexbet.io/pricing`;
  return message;
}

/**
 * Get feature list for tier
 * @param {string} tierId - Tier ID
 * @returns {string} Formatted feature list
 */
function getFeatureList(tierId) {
  const tier = getTier(tierId);
  
  let features = `✨ *${tier.name} Tier Features*\n`;
  features += `\n📊 ${tier.features.scans_per_day === 'unlimited' ? 'Unlimited' : tier.features.scans_per_day} scans/day\n`;
  
  if (tier.features.claude_analysis) {
    features += `🤖 Claude AI analysis\n`;
  }
  
  if (tier.features.player_props) {
    features += `🎭 Player props\n`;
  }
  
  if (tier.features.team_props) {
    features += `🏆 Team props\n`;
  }
  
  if (tier.features.ask_alex) {
    features += `🧠 Ask Alex (custom analysis)\n`;
  }
  
  if (tier.features.api_access) {
    features += `🔌 API access\n`;
  }

  return features;
}

/**
 * Calculate upgrade savings
 * @param {string} currentTierId - Current tier
 * @param {string} targetTierId - Target tier
 * @returns {Object} {monthlyDifference, annualSavings}
 */
function calculateUpgradeSavings(currentTierId, targetTierId) {
  const current = getTier(currentTierId);
  const target = getTier(targetTierId);
  
  const monthlyDifference = (target.price || 0) - (current.price || 0);
  const annualSavings = monthlyDifference * 12;

  return {
    currentPrice: current.price,
    targetPrice: target.price,
    monthlyDifference,
    annualSavings,
    isUpgrade: monthlyDifference > 0,
    isDowngrade: monthlyDifference < 0
  };
}

/**
 * Validate scan count against user tier
 * @param {Object} user - User object
 * @param {number} todaysScanCount - Today's scan count
 * @returns {Object} {valid: boolean, message?: string, limit?: number}
 */
function validateScanLimit(user, todaysScanCount) {
  const result = canUserScan(user, todaysScanCount);

  if (!result.allowed) {
    const tier = getTier(user.subscription.tier_id);
    return {
      valid: false,
      message: `⏳ You've used all ${result.limit} scans for today. Return tomorrow or upgrade to ${tier.name === 'Free' ? 'Sharp' : 'Elite'} for unlimited scans.`,
      limit: result.limit,
      upgrade_url: 'https://alexbet.io/upgrade'
    };
  }

  return {
    valid: true,
    remaining: result.remaining,
    limit: result.limit
  };
}

module.exports = {
  canUserPerformAction,
  canUserScan,
  getUserClaudeModels,
  formatTierInfo,
  generateUpgradeMessage,
  getFeatureList,
  calculateUpgradeSavings,
  validateScanLimit
};
