/**
 * Callback query handlers
 * Routes all callbacks based on prefix (action_*, bankroll_*, tz_*)
 */

const logger = require('../utils/logger');
const supabaseClient = require('../services/supabase-client');
const { handleTimezoneCallback } = require('./timezone');

let bot, userBankrolls, userTimezones;

function setContext(botInstance, bankrolls, timezones) {
  bot = botInstance;
  userBankrolls = bankrolls;
  userTimezones = timezones;
}

async function handleCallbackQuery(query) {
  const userId = query.from.id;
  const chatId = query.message.chat.id;
  const data = query.data;
  
  console.log(`\n[HANDLER 2] ========================================`);
  console.log(`[HANDLER 2] Callback received!`);
  console.log(`[HANDLER 2] User ID: ${userId}`);
  console.log(`[HANDLER 2] Chat ID: ${chatId}`);
  console.log(`[HANDLER 2] Data: ${data}`);
  console.log(`[HANDLER 2] ========================================\n`);
  
  try {
    // ========== TIMEZONE CALLBACKS (tz_*) ==========
    if (data && data.startsWith('tz_')) {
      console.log(`[HANDLER 2] ✅ TIMEZONE CALLBACK MATCHED: ${data}`);
      await handleTimezoneCallback(query);
      return;
    }
  
    // ========== BANKROLL CALLBACKS (bankroll_*) ==========
    const bankrollMatch = data.match(/^bankroll_(\\d+|custom)$/);
    if (bankrollMatch) {
      if (data === 'bankroll_custom') {
        bot.sendMessage(chatId, '💰 Please enter your custom bankroll amount (minimum $1):');
        userBankrolls[userId] = 'awaiting_bankroll';
        bot.answerCallbackQuery(query.id);
        return;
      }
      
      const amount = parseInt(bankrollMatch[1]);
      if (amount < 1) {
        bot.answerCallbackQuery(query.id, { text: '❌ Minimum bankroll is $1', show_alert: true });
        return;
      }
      
      userBankrolls[userId] = amount;
      
      try {
        await supabaseClient.upsertUser(userId, query.from.username || `user_${userId}`);
        await supabaseClient.supabase
          .from('users')
          .update({ bankroll: amount, updated_at: new Date() })
          .eq('telegram_id', userId);
        
        bot.editMessageText(`✅ Bankroll set to $${amount}\n\n🚀 Ready to find gems! Use /scan or tap below:`, {
          chat_id: chatId,
          message_id: query.message.message_id,
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔍 Scan for Gems', callback_data: 'action_scan' }, { text: '📊 View Stats', callback_data: 'action_stats' }],
              [{ text: '⚙️ Settings', callback_data: 'action_settings' }, { text: '💎 Premium', callback_data: 'action_subscribe' }]
            ]
          }
        });
      } catch (err) {
        bot.answerCallbackQuery(query.id, { text: '✅ Bankroll set (local only)', show_alert: false });
      }
      
      bot.answerCallbackQuery(query.id);
      return;
    }
    
    // ========== ACTION CALLBACKS (action_*) ==========
    if (data === 'action_settings') {
      bot.answerCallbackQuery(query.id);
      
      try {
        const currentTz = userTimezones[userId] || 'America/New_York';
        const tzDisplayMap = {
          'America/New_York': 'EST (New York)',
          'America/Chicago': 'CST (Chicago)',
          'America/Denver': 'MST (Denver)',
          'America/Los_Angeles': 'PST (Los Angeles)',
          'America/Anchorage': 'AKST (Alaska)',
          'Pacific/Honolulu': 'HST (Hawaii)'
        };
        
        const currentDisplay = tzDisplayMap[currentTz] || currentTz;
        
        logger.info('User accessed settings', { userId, currentTz });
        
        bot.sendMessage(chatId, `⚙️ *Settings*\n\n🌍 **Current Timezone:** ${currentDisplay}\n\nSelect new timezone:`, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: 'EST (New York)', callback_data: 'tz_est' }, { text: 'CST (Chicago)', callback_data: 'tz_cst' }],
              [{ text: 'MST (Denver)', callback_data: 'tz_mst' }, { text: 'PST (Los Angeles)', callback_data: 'tz_pst' }],
              [{ text: 'AKST (Alaska)', callback_data: 'tz_akst' }, { text: 'HST (Hawaii)', callback_data: 'tz_hst' }]
            ]
          }
        });
      } catch (err) {
        logger.error('Error in action_settings handler', { userId, error: err.message });
        bot.sendMessage(chatId, '❌ Error loading settings. Please try again.');
      }
      return;
    }
    
    if (data === 'action_scan') {
      bot.answerCallbackQuery(query.id);
      // Action scan logic handled by main scan handler
      return;
    }
    
    if (data === 'whop_learn_more') {
      bot.sendMessage(chatId, `
📚 What's Included?

✅ AlexBET Ebook:
• Kelly Criterion (corrected)
• CLV calculation
• Edge detection
• Bankroll management
• Real examples

✅ Bot Premium:
• Everything in ebook
• Live gem scanning
• Performance analytics
• Line shopping
• Priority support

Ready? /subscribe to purchase!
    `);
      bot.answerCallbackQuery(query.id);
      return;
    }
    
    // Unknown callback
    console.log(`[UNKNOWN CALLBACK] ${data}`);
    bot.answerCallbackQuery(query.id);
  } catch (err) {
    console.error(`[CALLBACK ERROR] ${err.message}`);
    bot.answerCallbackQuery(query.id, { text: '❌ Error processing action', show_alert: true });
  }
}

module.exports = {
  handleCallbackQuery,
  setContext
};
