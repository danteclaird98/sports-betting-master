/**
 * AlexBET Tier Model
 * Defines subscription tiers, features, and pricing
 */

const TIERS = {
  FREE: {
    id: 'free',
    name: 'Free',
    price: 0,
    currency: 'USD',
    billing_period: null,
    description: 'Get started with basic edge detection',
    features: {
      scans_per_day: 5,
      sports: ['nba', 'nfl', 'mlb', 'nhl', 'atp', 'epl'],
      markets: ['h2h', 'spreads', 'totals'],
      claude_analysis: false,
      kelly_sizing: true,
      export_format: null, // No exports
      custom_threshold: false,
      player_props: false,
      team_props: false,
      ask_alex: false,
      api_access: false,
      priority_support: false
    },
    limits: {
      max_users: null,
      max_teams: 1,
      retention_days: 7, // Keep bet history 7 days
      api_rate_limit: null
    }
  },

  SHARP: {
    id: 'sharp',
    name: 'Sharp',
    price: 49,
    currency: 'USD',
    billing_period: 'monthly',
    description: 'For serious bettors - player props & advanced analysis',
    features: {
      scans_per_day: 100,
      sports: ['nba', 'nfl', 'mlb', 'nhl', 'atp', 'epl'],
      markets: ['h2h', 'spreads', 'totals'],
      claude_analysis: true, // Haiku-tier AI
      kelly_sizing: true,
      export_format: ['csv', 'json'],
      custom_threshold: true,
      player_props: true,
      team_props: false,
      ask_alex: false, // Not in Sharp tier
      api_access: false,
      priority_support: true
    },
    limits: {
      max_users: 1,
      max_teams: 5,
      retention_days: 90, // 90 days of history
      api_rate_limit: 100 // Per hour
    }
  },

  ELITE: {
    id: 'elite',
    name: 'Elite',
    price: 99,
    currency: 'USD',
    billing_period: 'monthly',
    description: 'Pro-level - everything + team props + Ask Alex',
    features: {
      scans_per_day: 'unlimited',
      sports: ['nba', 'nfl', 'mlb', 'nhl', 'atp', 'epl', 'soccer', 'esports'],
      markets: ['h2h', 'spreads', 'totals', 'parlays'],
      claude_analysis: true, // Sonnet-tier AI (better)
      kelly_sizing: true,
      export_format: ['csv', 'json', 'pdf'],
      custom_threshold: true,
      player_props: true,
      team_props: true,
      ask_alex: true, // Custom AI analysis
      api_access: true,
      priority_support: true
    },
    limits: {
      max_users: 5, // Can add team members
      max_teams: 'unlimited',
      retention_days: 365, // Full year of history
      api_rate_limit: 1000 // Per hour
    }
  },

  ENTERPRISE: {
    id: 'enterprise',
    name: 'Enterprise',
    price: null, // Custom pricing
    currency: 'USD',
    billing_period: 'annual',
    description: 'Custom solution for betting syndicates & funds',
    features: {
      scans_per_day: 'unlimited',
      sports: ['nba', 'nfl', 'mlb', 'nhl', 'atp', 'epl', 'soccer', 'esports', 'custom'],
      markets: ['h2h', 'spreads', 'totals', 'parlays', 'custom'],
      claude_analysis: true, // Opus-tier AI (best)
      kelly_sizing: true,
      export_format: ['csv', 'json', 'pdf', 'xlsx', 'api'],
      custom_threshold: true,
      player_props: true,
      team_props: true,
      ask_alex: true,
      api_access: true,
      priority_support: true,
      dedicated_account_manager: true,
      custom_integration: true
    },
    limits: {
      max_users: 'unlimited',
      max_teams: 'unlimited',
      retention_days: 'unlimited',
      api_rate_limit: 10000 // Per hour
    }
  }
};

/**
 * Feature comparison for marketing
 */
const FEATURE_COMPARISON = {
  'Daily Scans': {
    free: '5',
    sharp: '100',
    elite: 'Unlimited',
    enterprise: 'Unlimited'
  },
  'Claude AI Analysis': {
    free: '❌',
    sharp: '✅ Haiku',
    elite: '✅ Sonnet',
    enterprise: '✅ Opus'
  },
  'Player Props': {
    free: '❌',
    sharp: '✅',
    elite: '✅',
    enterprise: '✅'
  },
  'Team Props': {
    free: '❌',
    sharp: '❌',
    elite: '✅',
    enterprise: '✅'
  },
  'Ask Alex': {
    free: '❌',
    sharp: '❌',
    elite: '✅',
    enterprise: '✅'
  },
  'Data Export': {
    free: '❌',
    sharp: 'CSV, JSON',
    elite: 'CSV, JSON, PDF',
    enterprise: 'All + API'
  },
  'Data Retention': {
    free: '7 days',
    sharp: '90 days',
    elite: '1 year',
    enterprise: 'Unlimited'
  },
  'API Access': {
    free: '❌',
    sharp: '❌',
    elite: '✅',
    enterprise: '✅'
  },
  'Priority Support': {
    free: '❌',
    sharp: '✅',
    elite: '✅',
    enterprise: '✅'
  },
  'Team Members': {
    free: '1',
    sharp: '1',
    elite: '5',
    enterprise: 'Unlimited'
  }
};

/**
 * Get tier by ID
 * @param {string} tierId - Tier identifier (free, sharp, elite, enterprise)
 * @returns {Object} Tier configuration
 */
function getTier(tierId) {
  const tier = TIERS[tierId.toUpperCase()];
  if (!tier) {
    throw new Error(`Invalid tier ID: ${tierId}`);
  }
  return tier;
}

/**
 * Get all tiers
 * @returns {Object} All tier configurations
 */
function getAllTiers() {
  return TIERS;
}

/**
 * Check if user has access to feature
 * @param {string} tierId - User's tier
 * @param {string} feature - Feature name
 * @returns {boolean}
 */
function hasFeature(tierId, feature) {
  try {
    const tier = getTier(tierId);
    const features = tier.features;
    
    // Handle nested features (e.g., 'export_format')
    if (feature.includes('.')) {
      const [parent, child] = feature.split('.');
      return features[parent] && features[parent].includes(child);
    }
    
    // Simple boolean or array check
    const value = features[feature];
    if (typeof value === 'boolean') {
      return value;
    }
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    if (value === 'unlimited') {
      return true;
    }
    return !!value;
  } catch (err) {
    return false;
  }
}

/**
 * Get limit for tier
 * @param {string} tierId - User's tier
 * @param {string} limit - Limit name
 * @returns {number|string|null}
 */
function getLimit(tierId, limit) {
  try {
    const tier = getTier(tierId);
    return tier.limits[limit];
  } catch (err) {
    return null;
  }
}

/**
 * Check if scans are unlimited
 * @param {string} tierId - User's tier
 * @returns {boolean}
 */
function isScansUnlimited(tierId) {
  try {
    const tier = getTier(tierId);
    return tier.features.scans_per_day === 'unlimited';
  } catch (err) {
    return false;
  }
}

/**
 * Get scan limit
 * @param {string} tierId - User's tier
 * @returns {number}
 */
function getScanLimit(tierId) {
  try {
    const tier = getTier(tierId);
    const limit = tier.features.scans_per_day;
    if (limit === 'unlimited') return Infinity;
    return parseInt(limit) || 0;
  } catch (err) {
    return 0;
  }
}

/**
 * Get eligible Claude models for tier
 * @param {string} tierId - User's tier
 * @returns {Array<string>} Array of eligible models
 */
function getEligibleClaudeModels(tierId) {
  try {
    const tier = getTier(tierId);
    if (!tier.features.claude_analysis) {
      return [];
    }
    
    // Model escalation based on tier
    switch (tierId.toLowerCase()) {
      case 'sharp':
        return ['claude-3-haiku-20240307'];
      case 'elite':
        return ['claude-3-haiku-20240307', 'claude-3-sonnet-20240229'];
      case 'enterprise':
        return ['claude-3-haiku-20240307', 'claude-3-sonnet-20240229', 'claude-3-opus-20240229'];
      default:
        return [];
    }
  } catch (err) {
    return [];
  }
}

/**
 * Validate subscription status
 * @param {Object} subscription - User subscription object
 * @returns {boolean}
 */
function isSubscriptionActive(subscription) {
  if (!subscription) return false;
  if (subscription.tier_id === 'free') return true; // Free tier always active
  if (!subscription.status) return false;
  if (subscription.status !== 'active') return false;
  if (subscription.expires_at && new Date(subscription.expires_at) < new Date()) {
    return false;
  }
  return true;
}

/**
 * Get remaining days for trial/subscription
 * @param {Object} subscription - User subscription object
 * @returns {number} Days remaining
 */
function getDaysRemaining(subscription) {
  if (!subscription || !subscription.expires_at) return null;
  const now = new Date();
  const expires = new Date(subscription.expires_at);
  const daysRemaining = Math.ceil((expires - now) / (1000 * 60 * 60 * 24));
  return Math.max(0, daysRemaining);
}

module.exports = {
  TIERS,
  FEATURE_COMPARISON,
  getTier,
  getAllTiers,
  hasFeature,
  getLimit,
  isScansUnlimited,
  getScanLimit,
  getEligibleClaudeModels,
  isSubscriptionActive,
  getDaysRemaining
};
