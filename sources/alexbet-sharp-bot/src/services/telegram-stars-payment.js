/**
 * Telegram Stars Payment Handler
 * Manages invoice creation, payment verification, and subscription processing
 * 
 * Currency: XTR (Telegram Stars)
 * Pricing:
 * - Monthly: 999 stars (~$9.99)
 * - Yearly: 9900 stars (~$99.99)
 * - Lifetime: 99900 stars (~$999)
 */

const logger = require('../utils/logger');
const {
  upsertUser,
  addSubscription,
  logPayment,
  getUser
} = require('./supabase-client');

// Pricing configuration
const PRICING = {
  monthly: {
    stars: 999,
    usd: 9.99,
    duration: 30,
    durationText: '30 days'
  },
  yearly: {
    stars: 9900,
    usd: 99.99,
    duration: 365,
    durationText: '365 days'
  },
  lifetime: {
    stars: 99900,
    usd: 999,
    duration: null,
    durationText: 'Forever'
  }
};

/**
 * Send subscription menu to user
 * @param {TelegramBot} bot - Telegram bot instance
 * @param {number} chatId - Chat ID
 */
function sendSubscriptionMenu(bot, chatId) {
  const keyboard = {
    inline_keyboard: [
      [
        {
          text: '💎 Monthly - $9.99 (30 days)',
          callback_data: 'buy_monthly'
        }
      ],
      [
        {
          text: '🚀 Yearly - $99.99 (365 days)',
          callback_data: 'buy_yearly'
        }
      ],
      [
        {
          text: '👑 Lifetime - $999 (Forever)',
          callback_data: 'buy_lifetime'
        }
      ],
      [
        {
          text: 'ℹ️ What\'s Included?',
          callback_data: 'sub_learn_more'
        }
      ]
    ]
  };

  const message = `
⭐ **AlexBET Sharp Premium**

Choose your subscription tier:

**💎 Monthly ($9.99)**
• Full bot access for 30 days
• Unlimited gem scanning
• Export all signals (no limits)
• Real-time updates

**🚀 Yearly ($99.99)**
• Full bot access for 365 days
• Unlimited gem scanning
• Export all signals (no limits)
• Real-time updates
• ~17% discount vs monthly

**👑 Lifetime ($999)**
• Full bot access forever
• Unlimited gem scanning
• Export all signals (no limits)
• Real-time updates
• Priority support

💳 Payments secured by Telegram Stars
🔄 Manual renewal (we'll remind you)
❌ No auto-renewal to worry about

Click a button below to subscribe:
  `;

  bot.sendMessage(chatId, message, {
    reply_markup: keyboard,
    parse_mode: 'Markdown'
  });
}

/**
 * Send invoice for payment
 * @param {TelegramBot} bot - Telegram bot instance
 * @param {number} chatId - Chat ID
 * @param {string} tier - 'monthly', 'yearly', or 'lifetime'
 * @param {number} userId - User ID for tracking
 */
async function sendInvoice(bot, chatId, tier, userId) {
  try {
    const pricing = PRICING[tier];
    if (!pricing) {
      bot.sendMessage(chatId, '❌ Invalid subscription tier');
      return;
    }

    const title = tier.charAt(0).toUpperCase() + tier.slice(1) + ' Subscription';
    const description = `AlexBET Sharp Bot Premium - ${pricing.durationText}`;
    
    // Telegram requires a unique invoice payload per user per tier
    const payload = `sub_${tier}_${userId}_${Date.now()}`;

    logger.info('Sending invoice', { chatId, tier, userId, payload });

    await bot.sendInvoice(
      chatId,
      title,
      description,
      payload,                    // invoice payload
      'XTR',                      // currency (Telegram Stars)
      [
        {
          label: `${tier.charAt(0).toUpperCase() + tier.slice(1)} Plan`,
          amount: pricing.stars
        }
      ],
      {
        currency: 'XTR',
        max_tip_amount: 0,        // Optional: allow tips
        is_flexible: false
      }
    );

    logger.info('Invoice sent successfully', { tier, userId });
  } catch (err) {
    logger.error('Error sending invoice', { tier, userId, error: err.message });
    bot.sendMessage(chatId, `❌ Failed to process payment: ${err.message}`);
  }
}

/**
 * Handle successful payment
 * @param {object} msg - Telegram message object with successful_payment
 * @param {TelegramBot} bot - Telegram bot instance
 */
async function handleSuccessfulPayment(msg, bot) {
  try {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const username = msg.from.username || `user_${userId}`;
    const payment = msg.successful_payment;
    
    logger.info('Processing successful payment', {
      userId,
      chargeId: payment.telegram_payment_charge_id,
      payload: payment.invoice_payload
    });

    // Extract tier from payload (format: sub_TIER_USERID_TIMESTAMP)
    const payloadParts = payment.invoice_payload.split('_');
    const tier = payloadParts[1]; // 'monthly', 'yearly', or 'lifetime'

    if (!PRICING[tier]) {
      logger.error('Invalid tier in payload', { tier, payload: payment.invoice_payload });
      bot.sendMessage(chatId, '❌ Payment processing failed: invalid tier');
      return;
    }

    // 1. Ensure user exists in database
    const { data: userData, error: userError } = await upsertUser(userId, username);
    if (userError) {
      logger.error('Error upserting user', { userId, error: userError });
      bot.sendMessage(chatId, '❌ Database error - please contact support');
      return;
    }

    // 2. Add subscription
    const { data: subData, error: subError } = await addSubscription(
      userId,
      tier,
      'telegram_stars'
    );
    if (subError) {
      logger.error('Error adding subscription', { userId, tier, error: subError });
      bot.sendMessage(chatId, '❌ Failed to activate subscription');
      return;
    }

    // 3. Log payment for audit trail
    const { error: logError } = await logPayment({
      user_id: userId,
      amount_stars: PRICING[tier].stars,
      tier,
      status: 'completed',
      payment_method: 'telegram_stars',
      telegram_charge_id: payment.telegram_payment_charge_id
    });
    if (logError) {
      logger.warn('Error logging payment (non-critical)', { userId, error: logError });
    }

    // 4. Send confirmation to user
    const expiryDate = subData.subscription_expiry
      ? new Date(subData.subscription_expiry).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        })
      : 'Never';

    const confirmationMsg = `
✅ **Payment Successful!**

**Subscription Activated:**
• Tier: ${tier.charAt(0).toUpperCase() + tier.slice(1)}
• Amount: $${PRICING[tier].usd} (${PRICING[tier].stars} ⭐)
• Expires: ${expiryDate}

**Next Steps:**
1. Use /scan to find top gems
2. Use /export to download signals
3. Use /status to check subscription

Questions? Contact support.
    `;

    await bot.sendMessage(chatId, confirmationMsg, { parse_mode: 'Markdown' });

    logger.info('Payment processed successfully', {
      userId,
      tier,
      chargeId: payment.telegram_payment_charge_id
    });
  } catch (err) {
    logger.error('Error handling successful payment', { error: err.message });
    bot.sendMessage(msg.chat.id, '❌ Payment received but activation failed. Please contact support.');
  }
}

/**
 * Handle pre-checkout query (verification before payment)
 * @param {object} query - Pre-checkout query from Telegram
 * @param {TelegramBot} bot - Telegram bot instance
 */
async function handlePreCheckout(query, bot) {
  try {
    const userId = query.from.id;
    const payload = query.invoice_payload;

    logger.info('Pre-checkout query', { userId, payload });

    // Verify payload format
    const payloadParts = payload.split('_');
    const tier = payloadParts[1];

    if (!PRICING[tier]) {
      logger.warn('Invalid tier in pre-checkout', { userId, tier });
      await bot.answerPreCheckoutQuery(query.id, false, 'Invalid subscription tier');
      return;
    }

    // Answer OK
    await bot.answerPreCheckoutQuery(query.id, true);
    logger.info('Pre-checkout approved', { userId, tier });
  } catch (err) {
    logger.error('Error handling pre-checkout', { error: err.message });
    bot.answerPreCheckoutQuery(query.id, false, 'Payment processing error');
  }
}

/**
 * Handle callback query for subscription menu
 * @param {object} query - Callback query
 * @param {TelegramBot} bot - Telegram bot instance
 */
async function handleCallbackQuery(query, bot) {
  try {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data;

    // Always answer callback immediately
    await bot.answerCallbackQuery(query.id);

    if (data === 'buy_monthly') {
      await sendInvoice(bot, chatId, 'monthly', userId);
    } else if (data === 'buy_yearly') {
      await sendInvoice(bot, chatId, 'yearly', userId);
    } else if (data === 'buy_lifetime') {
      await sendInvoice(bot, chatId, 'lifetime', userId);
    } else if (data === 'sub_learn_more') {
      const infoMsg = `
📚 **What's Included in Premium?**

✅ **Unlimited Gem Scanning**
• Access /scan anytime
• 6 sports × 3 markets (18 gems per scan)
• Real-time odds comparison

✅ **Export All Picks**
• CSV, JSON, TXT formats
• No gem limit (free tier: 3 gems max)
• Download for external analysis

✅ **Priority Support**
• Fast response times
• Direct issue escalation

✅ **Lifetime Access (Tier Only)**
• Never expires
• Lifetime updates included
• Best value for serious bettors

📊 **Comparison:**
• Free: Limited to 3 gems export
• Monthly: Full access for 30 days
• Yearly: Full access for 365 days  
• Lifetime: Full access forever

Ready to upgrade? /subscribe
      `;

      await bot.sendMessage(chatId, infoMsg, { parse_mode: 'Markdown' });
    }
  } catch (err) {
    logger.error('Error handling callback query', { error: err.message });
  }
}

/**
 * Register payment handlers with bot
 * @param {TelegramBot} bot - Telegram bot instance
 */
function registerPaymentHandlers(bot) {
  // /subscribe command - show subscription menu
  bot.onText(/\/subscribe/, (msg) => {
    sendSubscriptionMenu(bot, msg.chat.id);
  });

  // Callback queries - tier selection
  bot.on('callback_query', (query) => {
    if (query.data.startsWith('buy_') || query.data === 'sub_learn_more') {
      handleCallbackQuery(query, bot);
    }
  });

  // Pre-checkout query - verify payment
  bot.on('pre_checkout_query', (query) => {
    handlePreCheckout(query, bot);
  });

  // Successful payment
  bot.on('successful_payment', (msg) => {
    handleSuccessfulPayment(msg, bot);
  });

  logger.info('✅ Telegram Stars payment handlers registered');
}

module.exports = {
  PRICING,
  sendSubscriptionMenu,
  sendInvoice,
  handleSuccessfulPayment,
  handlePreCheckout,
  handleCallbackQuery,
  registerPaymentHandlers
};
