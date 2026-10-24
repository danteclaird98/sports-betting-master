/**
 * /stats handler
 * View user performance statistics
 */

const logger = require('../utils/logger');

let bot, statsLimiter;

function setContext(botInstance, limiter) {
  bot = botInstance;
  statsLimiter = limiter;
}

function handleStats(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // CHECK RATE LIMIT FIRST
  const rateLimitResult = statsLimiter.isRateLimited(userId);
  if (rateLimitResult.limited) {
    const msg_text = `⏳ Rate limited. Try again in ${rateLimitResult.secondsLeft}s`;
    return bot.sendMessage(chatId, msg_text);
  }

  bot.sendMessage(chatId, `
*📊 Your Stats*
🔄 This feature is coming soon!

Track your P&L, win rate, and bet history:
📊 https://alexbet-lite.netlify.app
  `, { parse_mode: 'Markdown' });
}

module.exports = { handleStats, setContext };
