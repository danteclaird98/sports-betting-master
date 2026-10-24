/**
 * /bankroll command handler
 * Update user's betting bankroll
 */

const logger = require('../utils/logger');
const supabaseClient = require('../services/supabase-client');
const { validateBankroll } = require('../utils/validation');

let bot, userBankrolls, bankrollLimiter;

function setContext(botInstance, bankrolls, limiter) {
  bot = botInstance;
  userBankrolls = bankrolls;
  bankrollLimiter = limiter;
}

async function handleBankroll(msg, match) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const inlineAmount = match[1]; // Extract /bankroll 500
  
  // CHECK RATE LIMIT FIRST
  const rateLimitResult = bankrollLimiter.isRateLimited(userId);
  if (rateLimitResult.limited) {
    const msg_text = `⏳ Rate limited. Try again in ${rateLimitResult.secondsLeft}s`;
    return bot.sendMessage(chatId, msg_text);
  }
  
  const currentBankroll = userBankrolls[userId] && typeof userBankrolls[userId] === 'number' 
    ? userBankrolls[userId] 
    : 'Not set';
  
  // If amount provided inline (e.g., /bankroll 500)
  if (inlineAmount) {
    const validation = validateBankroll(inlineAmount);
    
    if (!validation.valid) {
      bot.sendMessage(chatId, validation.error);
      logger.warn('Invalid bankroll provided inline', { userId, input: inlineAmount, error: validation.error });
      return;
    }
    
    userBankrolls[userId] = validation.value;
    
    // Save to database
    try {
      await supabaseClient.upsertUser(userId, msg.from.username || `user_${userId}`);
      const { error } = await supabaseClient.supabase
        .from('users')
        .update({ bankroll: validation.value, updated_at: new Date() })
        .eq('telegram_id', userId);
      
      if (!error) {
        logger.info('Bankroll set inline', { userId, bankroll: validation.value, chatId });
        bot.sendMessage(chatId, `✅ Bankroll set to $${validation.value}\\n\\nNow use /scan to find gems!`);
      } else {
        logger.warn('Could not save bankroll to database:', error.message);
        bot.sendMessage(chatId, `✅ Bankroll set to $${validation.value} (local only)\\n\\nNow use /scan to find gems!`);
      }
    } catch (err) {
      logger.warn('Error saving bankroll:', err.message);
      bot.sendMessage(chatId, `✅ Bankroll set to $${validation.value}\\n\\nNow use /scan to find gems!`);
    }
    return;
  }
  
  // No amount provided - ask for it
  bot.sendMessage(chatId, `
💰 *Update Your Bankroll*

Current bankroll: *$${currentBankroll}*

Please enter your new betting bankroll (minimum $1):
  `, { parse_mode: 'Markdown' });
  
  userBankrolls[userId] = 'awaiting_bankroll_update';
  logger.debug('Awaiting user bankroll update', { userId, chatId });
}

module.exports = {
  handleBankroll,
  setContext
};
