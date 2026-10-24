/**
 * /timezone command handler
 * Set user's timezone (USA only)
 */

const logger = require('../utils/logger');
const supabaseClient = require('../services/supabase-client');

let bot, userTimezones;

function setContext(botInstance, timezones) {
  bot = botInstance;
  userTimezones = timezones;
}

async function handleTimezone(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
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
    
    logger.info('User accessed /timezone command', { userId, currentTz });
    
    bot.sendMessage(chatId, `🌍 *Select Your Timezone*\n\nCurrent: **${currentDisplay}**\n\nChoose your US timezone:`, {
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
    logger.error('Error in /timezone command:', err);
    bot.sendMessage(chatId, '❌ Error loading timezone settings. Please try again.');
  }
}

// Handle timezone callback selection
async function handleTimezoneCallback(query) {
  const data = query.data;
  const userId = query.from.id;
  const chatId = query.message.chat.id;
  
  try {
    console.log(`[TZ] About to answer callback query...`);
    // Answer immediately with loading indicator
    await bot.answerCallbackQuery(query.id, '⏳ Setting timezone...', false);
    console.log(`[TZ] ✅ Answered callback query`);
    
    // FIX: Map UI shortcuts to IANA timezone strings
    const timezoneMap = {
      'tz_est': 'America/New_York',
      'tz_cst': 'America/Chicago',
      'tz_mst': 'America/Denver',
      'tz_pst': 'America/Los_Angeles',
      'tz_akst': 'America/Anchorage',
      'tz_hst': 'Pacific/Honolulu'
    };
    
    const ianaTimezone = timezoneMap[data] || 'America/New_York';
    
    // Send confirmation message with display name
    const tzName = data === 'tz_mst' ? 'MST (Denver)' : 
                   data === 'tz_est' ? 'EST (New York)' :
                   data === 'tz_cst' ? 'CST (Chicago)' :
                   data === 'tz_pst' ? 'PST (Los Angeles)' :
                   data === 'tz_akst' ? 'AKST (Alaska)' :
                   data === 'tz_hst' ? 'HST (Hawaii)' : data;
    
    // FIX: UPDATE userTimezones in memory
    userTimezones[userId] = ianaTimezone;
    console.log(`[TZ] Updated userTimezones[${userId}] = ${ianaTimezone}`);
    
    // FIX: UPDATE database
    try {
      await supabaseClient.upsertUser(userId, query.from.username || `user_${userId}`);
      const { error } = await supabaseClient.supabase
        .from('users')
        .update({ timezone: ianaTimezone, updated_at: new Date() })
        .eq('telegram_id', userId);
      
      if (!error) {
        console.log(`[TZ] Saved timezone to database: ${ianaTimezone}`);
        logger.info('Timezone saved to database', { userId, timezone: ianaTimezone });
      } else {
        console.warn(`[TZ] Database error:`, error.message);
        logger.warn('Failed to save timezone to database', { userId, error: error.message });
      }
    } catch (dbErr) {
      console.warn(`[TZ] Database save failed, using in-memory only:`, dbErr.message);
      logger.warn('Exception saving timezone to database', { userId, error: dbErr.message });
    }
    
    console.log(`[TZ] About to send confirmation message to ${chatId}: ${tzName}`);
    await bot.sendMessage(chatId, `✅ **Timezone Set**\n\nYou are now using: **${tzName}** (${ianaTimezone})`);
    console.log(`[TZ] ✅ Sent confirmation message`);
  } catch (err) {
    console.error(`[TZ ERROR] Exception caught: ${err.message}`);
    console.error(`[TZ ERROR] Stack: ${err.stack}`);
    try {
      bot.answerCallbackQuery(query.id, '❌ Error: ' + err.message, true);
    } catch (e) {
      console.error(`[TZ ERROR] Failed to answer callback: ${e.message}`);
    }
  }
}

module.exports = {
  handleTimezone,
  handleTimezoneCallback,
  setContext
};
