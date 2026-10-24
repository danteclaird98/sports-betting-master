/**
 * /start command handler
 * Professional welcome with inline buttons
 */

const logger = require('../utils/logger');
const supabaseClient = require('../services/supabase-client');

// These need to be passed in from the main file
let bot, isAdmin, userBankrolls, userTimezones;

function setContext(botInstance, isAdminFn, bankrolls, timezones) {
  bot = botInstance;
  isAdmin = isAdminFn;
  userBankrolls = bankrolls;
  userTimezones = timezones;
}

async function handleStart(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const userName = msg.from.username || 'anonymous';
  
  logger.info('User initiated /start command', { userId, userName, chatId, isAdmin: isAdmin(userId) });
  
  // Clear any lingering awaiting state
  if (userBankrolls[userId] === 'awaiting_bankroll' || userBankrolls[userId] === 'awaiting_bankroll_update') {
    userBankrolls[userId] = 100; // Reset to default
    logger.debug('Cleared lingering bankroll state', { userId });
  }
  
  // Load existing timezone and bankroll from database if available
  try {
    const { data: user } = await supabaseClient.getUser(userId);
    if (user) {
      // Load bankroll if available
      if (user.bankroll) {
        userBankrolls[userId] = user.bankroll;
      }
      
      // FIX: Load timezone INDEPENDENTLY of bankroll
      if (user.timezone) {
        userTimezones[userId] = user.timezone;
        logger.info('Loaded timezone from database', { userId, timezone: user.timezone });
      } else {
        // Set default timezone for new users
        userTimezones[userId] = 'America/New_York';
      }
      
      logger.info('Loaded user data from database', { 
        userId, 
        bankroll: user.bankroll || 'not set', 
        timezone: user.timezone || 'default (America/New_York)'
      });
    } else {
      // New user - set default timezone
      userTimezones[userId] = 'America/New_York';
    }
  } catch (err) {
    logger.debug('Could not load user data from database:', err.message);
    // Set default timezone even if database fails
    userTimezones[userId] = 'America/New_York';
  }
  
  // Professional welcome message
  const welcomeMessage = `
🎯 *AlexBET Sharp - Professional Sports Betting*

Find profitable edges in 6 sports:
*NFL • NBA • MLB • NHL • ATP Tennis • EPL Soccer*

Markets: *Moneyline, Spreads, Totals*
Real-time odds, edge detection, CLV tracking

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✨ *What can this bot do?*

🔍 */scan* - Find top gems
📊 */stats* - Your performance  
📥 */export* - Download data (CSV/JSON/PDF)
🔀 */compare* - Line shopping
🌍 */timezone* - Set timezone
📱 */lite* - Web app tracker
❓ */help* - All commands

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚀 Track bets: https://alexbet-lite.netlify.app
  `;
  
  // Check if user already has bankroll set
  if (userBankrolls[userId] && typeof userBankrolls[userId] === 'number') {
    bot.sendMessage(chatId, welcomeMessage, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔍 Scan for Gems', callback_data: 'action_scan' }, { text: '📊 View Stats', callback_data: 'action_stats' }],
          [{ text: '💰 Update Bankroll ($' + userBankrolls[userId] + ')', callback_data: 'action_bankroll' }],
          [{ text: '⚙️ Settings', callback_data: 'action_settings' }, { text: '💎 Premium', callback_data: 'action_subscribe' }],
          [{ text: '📱 Go to Lite App', url: 'https://alexbet-lite.netlify.app' }],
          [{ text: '📢 Share Bot', url: 'https://t.me/AlexBetSharp_v2_Bot' }, { text: '❓ Commands', callback_data: 'action_help' }]
        ]
      }
    });
  } else {
    // New user - ask for bankroll
    bot.sendMessage(chatId, welcomeMessage + `

💰 *What's your betting bankroll?*
(minimum $1, or reply with a number)
    `, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '💵 $50', callback_data: 'bankroll_50' }, { text: '💵 $100', callback_data: 'bankroll_100' }, { text: '💵 $250', callback_data: 'bankroll_250' }],
          [{ text: '💵 $500', callback_data: 'bankroll_500' }, { text: '💵 $1000', callback_data: 'bankroll_1000' }],
          [{ text: '✏️ Enter Custom Amount', callback_data: 'bankroll_custom' }],
          [{ text: '📢 Share with Friends', url: 'https://t.me/AlexBetSharp_v2_Bot' }]
        ]
      }
    });
    
    userBankrolls[userId] = 'awaiting_bankroll';
    logger.debug('Awaiting user bankroll input', { userId, chatId });
  }
}

module.exports = {
  handleStart,
  setContext
};
