/**
 * Whop Payment Handler
 * Manages subscription verification and access control for:
 * 1. Bot subscriptions (direct bot access)
 * 2. Channel subscriptions (private telegram channel)
 * 
 * API Docs: https://docs.whop.com
 */

const https = require('https');
const logger = require('../utils/logger');
const { upsertUser, addSubscription, logPayment, getUser } = require('./supabase-client');

const WHOP_API_KEY = process.env.WHOP_API_KEY;
const WHOP_STORE_URL = process.env.WHOP_STORE_URL || 'https://whop.com/joined/oddsify-shop/';

// Whop subscription plans (configure in Whop dashboard)
const WHOP_PRODUCTS = {
  'bot_monthly': {
    name: 'Bot Monthly',
    duration: 30,
    durationText: '30 days',
    gems: 10,
    markets: ['moneyline', 'totals', 'spreads'],
    description: 'Monthly bot access'
  },
  'bot_yearly': {
    name: 'Bot Yearly',
    duration: 365,
    durationText: '365 days',
    gems: 20,
    markets: ['moneyline', 'totals', 'spreads'],
    description: 'Yearly bot access'
  },
  'bot_lifetime': {
    name: 'Bot Lifetime',
    duration: null,
    durationText: 'Forever',
    gems: 999,
    markets: ['moneyline', 'totals', 'spreads'],
    description: 'Lifetime bot access'
  },
  'channel_monthly': {
    name: 'Channel Monthly',
    duration: 30,
    durationText: '30 days',
    type: 'channel',
    description: 'Monthly private channel access'
  },
  'channel_yearly': {
    name: 'Channel Yearly',
    duration: 365,
    durationText: '365 days',
    type: 'channel',
    description: 'Yearly private channel access'
  }
};

/**
 * Make authenticated request to Whop API
 */
function makeWhopRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.whop.com',
      path: path,
      method: method,
      headers: {
        'Authorization': `Bearer ${WHOP_API_KEY}`,
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(`Whop API ${res.statusCode}: ${parsed.message || data}`));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error(`Failed to parse Whop response: ${data}`));
        }
      });
    });

    req.on('error', reject);
    
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

/**
 * Verify user subscription from Whop
 * @param {string} telegramId - User's Telegram ID
 * @returns {Object} Subscription data or null
 */
async function verifyUserSubscription(telegramId) {
  try {
    if (!WHOP_API_KEY) {
      logger.warn('WHOP_API_KEY not configured');
      return null;
    }

    // Get user from database
    const user = await getUser(telegramId);
    if (!user || !user.whop_user_id) {
      return null;
    }

    // Fetch subscriptions from Whop
    const response = await makeWhopRequest('GET', `/v1/memberships?user_id=${user.whop_user_id}`);
    
    if (!response.data || response.data.length === 0) {
      return null;
    }

    // Get most recent active subscription
    const subscriptions = response.data
      .filter(sub => sub.status === 'active')
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    if (subscriptions.length === 0) {
      return null;
    }

    const subscription = subscriptions[0];
    const product = WHOP_PRODUCTS[subscription.product_id];

    return {
      product_id: subscription.product_id,
      product_name: product?.name || subscription.product_id,
      status: subscription.status,
      created_at: subscription.created_at,
      expires_at: subscription.expires_at,
      is_active: subscription.status === 'active',
      type: product?.type || 'bot'
    };
  } catch (err) {
    logger.error('Error verifying Whop subscription:', err);
    return null;
  }
}

/**
 * Determine user tier based on Whop subscription
 */
function getTierFromWhopProduct(productId) {
  const product = WHOP_PRODUCTS[productId];
  if (!product) return 'free';
  
  if (product.name.includes('Lifetime')) return 'lifetime';
  if (product.name.includes('Yearly')) return 'yearly';
  if (product.name.includes('Monthly')) return 'monthly';
  
  return 'free';
}

/**
 * Send subscription menu with Whop link
 */
function sendSubscriptionMenu(bot, chatId) {
  const keyboard = {
    inline_keyboard: [
      [
        {
          text: '💎 Bot Monthly - $9.99',
          url: `${WHOP_STORE_URL}?product=bot_monthly`
        }
      ],
      [
        {
          text: '🚀 Bot Yearly - $99.99',
          url: `${WHOP_STORE_URL}?product=bot_yearly`
        }
      ],
      [
        {
          text: '👑 Bot Lifetime - $999',
          url: `${WHOP_STORE_URL}?product=bot_lifetime`
        }
      ],
      [
        {
          text: '📊 Channel Monthly - $9.99',
          url: `${WHOP_STORE_URL}?product=channel_monthly`
        }
      ],
      [
        {
          text: '📈 Channel Yearly - $99.99',
          url: `${WHOP_STORE_URL}?product=channel_yearly`
        }
      ],
      [
        {
          text: 'ℹ️ What\'s Included?',
          callback_data: 'whop_learn_more'
        }
      ]
    ]
  };

  const message = `
⭐ **AlexBET Sharp - Premium Access**

Choose your subscription:

**🤖 BOT SUBSCRIPTIONS**
├─ Direct bot access
├─ /scan gem finder
├─ /stats analytics
├─ /export features
└─ /alerts webhooks

**📊 CHANNEL SUBSCRIPTIONS**
├─ Private Telegram channel
├─ Daily sharp alerts
├─ Educational content
├─ Community support
└─ Live analysis

**Pricing:**
• Bot Monthly: $9.99 (30 days)
• Bot Yearly: $99.99 (365 days)
• Bot Lifetime: $999 (Forever)
• Channel Monthly: $9.99
• Channel Yearly: $99.99

✨ You can subscribe to both!
  `;

  bot.sendMessage(chatId, message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard
  });
}

/**
 * Register payment handlers with bot
 */
function registerPaymentHandlers(bot) {
  // /subscribe command
  bot.onText(/\/(subscribe|pricing)/, (msg) => {
    sendSubscriptionMenu(bot, msg.chat.id);
  });

  // Learn more callback - ONLY handle whop callbacks, let timezone/other callbacks pass through
  bot.on('callback_query', (query) => {
    // Only process whop-specific callbacks, let others be handled by other handlers
    if (query.data === 'whop_learn_more') {
      const features = `
✅ **BOT Features (All Tiers)**
• Real-time gem scanning (6 sports)
• Edge value calculation (CLV)
• Sharp money detection
• Performance analytics
• Data export (CSV/JSON/PDF)
• Discord/Slack alerts
• Timezone support

✅ **CHANNEL Features**
• Daily sharp signals analysis
• Weekly strategy deep dives
• Community discussions
• Q&A sessions
• Early access to features

Ready to upgrade? Click a plan above!
      `;
      bot.sendMessage(query.message.chat.id, features, { parse_mode: 'Markdown' });
      bot.answerCallbackQuery(query.id);
    }
    // NOTE: Do NOT answer callback or handle timezone/other callbacks here - let other handlers process them
  });

  logger.info('Whop payment handlers registered');
}

/**
 * Check if user has active Whop subscription
 */
async function hasActiveSubscription(telegramId) {
  const subscription = await verifyUserSubscription(telegramId);
  return subscription && subscription.is_active;
}

/**
 * Get user's subscription tier from Whop
 */
async function getUserTier(telegramId) {
  const subscription = await verifyUserSubscription(telegramId);
  if (!subscription) return 'free';
  return getTierFromWhopProduct(subscription.product_id);
}

/**
 * Get subscription details for user
 */
async function getSubscriptionDetails(telegramId) {
  const subscription = await verifyUserSubscription(telegramId);
  if (!subscription) {
    return {
      tier: 'free',
      status: 'inactive',
      gems: 3,
      markets: ['moneyline'],
      export: false
    };
  }

  const product = WHOP_PRODUCTS[subscription.product_id];
  return {
    tier: getTierFromWhopProduct(subscription.product_id),
    status: subscription.status,
    product_name: subscription.product_name,
    created_at: subscription.created_at,
    expires_at: subscription.expires_at,
    gems: product?.gems || 3,
    markets: product?.markets || ['moneyline'],
    export: true,
    type: product?.type || 'bot'
  };
}

module.exports = {
  registerPaymentHandlers,
  verifyUserSubscription,
  hasActiveSubscription,
  getUserTier,
  getSubscriptionDetails,
  getTierFromWhopProduct,
  sendSubscriptionMenu,
  WHOP_PRODUCTS
};
