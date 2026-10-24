require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');

// Service imports
const ClaudeOptimizer = require('./claude-optimizer');
const RateLimiter = require('./src/services/rateLimiter');
const logger = require('./src/utils/logger');
const { validateBankroll, validateTimezone, parseAPIResponse } = require('./src/utils/validation');
const supabaseClient = require('./src/services/supabase-client');
const { registerPaymentHandlers, getUserTier } = require('./src/services/whop-payment');
const { getSubscriptionDetails, isAdmin: checkIsAdmin } = require('./src/services/auth');

// Handler imports
const startHandler = require('./src/handlers/start');
const scanHandler = require('./src/handlers/scan');
const statsHandler = require('./src/handlers/stats');
const exportHandler = require('./src/handlers/export');
const bankrollHandler = require('./src/handlers/bankroll');
const timezoneHandler = require('./src/handlers/timezone');
const utilsCommands = require('./src/handlers/utils-commands');
const callbackHandlers = require('./src/handlers/callback-handlers');

// Initialize bot
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: false }); // Disable polling initially

// Delay polling start by 45 seconds to allow Telegram to forget old connections
console.log('⏳ Delaying polling for 45 seconds to reset Telegram connection state...');
setTimeout(() => {
  console.log('🚀 Starting bot polling...');
  bot.startPolling();
}, 45000);

// Initialize Supabase and payment handlers
(async () => {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      await supabaseClient.initializeTables();
      console.log('✅ Supabase initialized');
    } catch (err) {
      console.warn('⚠️ Supabase initialization warning:', err.message);
    }
  } else {
    console.warn('⚠️ Supabase not configured - subscriptions will not persist');
  }
})();

// Initialize payment handlers (registers /subscribe command and payment webhooks)
registerPaymentHandlers(bot);

// ✅ Admin list - these users bypass all restrictions
const ADMIN_IDS = [8502906149]; // Jesse Collins

// Helper function to check if user is admin
function isAdmin(userId) {
  return ADMIN_IDS.includes(userId);
}

// Set bot commands for autocomplete menu when user types /
// Wrapped in try-catch to prevent crash if Telegram API has issues
try {
  bot.setMyCommands([
    { command: 'start', description: 'Initialize bot' },
    { command: 'scan', description: 'Find +EV gems across 6 sports' },
    { command: 'stats', description: 'View your performance stats' },
    { command: 'export', description: 'Export scan results (CSV/JSON)' },
    { command: 'subscribe', description: 'Upgrade to paid tier' },
    { command: 'status', description: 'Check subscription status' },
    { command: 'bankroll', description: 'Set your betting bankroll' },
    { command: 'timezone', description: 'Set timezone (EST/CST/MST/PST)' },
    { command: 'lite', description: 'Open AlexBET Lite tracker' },
    { command: 'help', description: 'Show all commands' }
  ]).catch(err => {
    console.warn('[WARN] setMyCommands failed (non-critical):', err.message);
  });
  
  // Set bot short description (appears in Telegram search + profile)
  bot.api.setMyShortDescription({
    short_description: '🎯 Find profitable sports betting edges with AI-powered +EV scanning across 6 sports'
  }).catch(err => {
    console.warn('[WARN] setMyShortDescription failed (non-critical):', err.message);
  });
  
  // Set bot detailed description (appears in bot profile)
  // Note: Telegram limits to 512 characters including line breaks
  bot.api.setMyDescription({
    description: `🎯 AlexBET Sharp - Professional Sports Betting

Find +EV edges with AI-powered analysis across 6 sports (NFL, NBA, MLB, NHL, ATP, EPL)

📊 Markets: Moneyline, Spreads, Totals
🔍 Real-time odds scanning & edge detection
📈 CLV tracking & performance analytics
🎁 Free & premium tiers

/scan - Find gems | /stats - Your stats | /export - Download data | /lite - Web app`
  }).catch(err => {
    console.warn('[WARN] setMyDescription failed (non-critical):', err.message);
  });
} catch (e) {
  console.warn('[WARN] setMyCommands/setMyDescription error (non-critical):', e.message);
}

const ODDS_API_KEY = process.env.ODDS_API_KEY;
const whopApiKey = process.env.WHOP_API_KEY;

if (!ODDS_API_KEY) {
  console.error('❌ CRITICAL: ODDS_API_KEY not set in .env');
  process.exit(1);
}
if (!whopApiKey) {
  console.warn('⚠️ WARNING: WHOP_API_KEY not set in .env (subscription features will be disabled)');
}
const whopStoreUrl = 'https://whop.com/oddsify-shop';

// Initialize ClaudeOptimizer
// ✅ DEPLOYMENT: 2026-04-21 09:55 - Force fresh restart
// UPDATED (2026-04-18 09:50): Re-enabled with Haiku-only mode (no Sonnet/Opus)
// Reduced cost: ~1x vs 10x previous cascade
let claudeOptimizer = null;
if (process.env.ANTHROPIC_API_KEY) {
  try {
    claudeOptimizer = new ClaudeOptimizer(process.env.ANTHROPIC_API_KEY);
    console.log('✅ Claude optimizer initialized (Haiku-only mode)');
  } catch (err) {
    console.warn('⚠️ Claude optimizer failed:', err.message);
  }
}

// Initialize rate limiters
// scanLimiter: 10 requests per minute per user
// exportLimiter: 5 requests per minute (more expensive operation)
// statsLimiter: 20 requests per minute (cheap)
// bankrollLimiter: 5 requests per minute (config operation)
const scanLimiter = new RateLimiter(10, 60000); // 10 req/min
const exportLimiter = new RateLimiter(5, 60000); // 5 req/min
const statsLimiter = new RateLimiter(20, 60000); // 20 req/min
const bankrollLimiter = new RateLimiter(5, 60000); // 5 req/min
const apiErrorTracker = new Map(); // userId -> {count, resetTime}

logger.info('Rate limiters initialized', {
  scanLimit: '10 requests per 60 seconds',
  exportLimit: '5 requests per 60 seconds',
  statsLimit: '20 requests per 60 seconds',
  bankrollLimit: '5 requests per 60 seconds',
  purpose: 'Prevent abuse and track API failures'
});

// User timezones (stored per user)
const userTimezones = {};

// Store user bankrolls in memory (in production, use Supabase)
const userBankrolls = {};

// Store latest scan results per user (for export functionality)
const userLatestScans = {};

// Cleanup old scans every hour
setInterval(() => {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  Object.keys(userLatestScans).forEach(userId => {
    if (userLatestScans[userId].timestamp < oneHourAgo) {
      delete userLatestScans[userId];
    }
  });
}, 60 * 60 * 1000);

console.log('🤖 AlexBET Sharp Bot starting (h2h + spreads + totals)...');

// ============================================================================
// REGISTER HANDLERS
// ============================================================================

// Initialize handler contexts
startHandler.setContext(bot, isAdmin, userBankrolls, userTimezones);
scanHandler.setContext(bot, isAdmin, userBankrolls, userTimezones, scanLimiter, claudeOptimizer, userLatestScans);
exportHandler.setContext(bot, isAdmin, userLatestScans, exportLimiter);
statsHandler.setContext(bot, statsLimiter);
bankrollHandler.setContext(bot, userBankrolls, bankrollLimiter);
timezoneHandler.setContext(bot, userTimezones);
utilsCommands.setContext(bot);
callbackHandlers.setContext(bot, userBankrolls, userTimezones);

// Register /start command
bot.onText(/\/start/, async (msg) => {
  await startHandler.handleStart(msg);
});

// Handle quick bankroll selection buttons & other text messages
bot.on('message', async (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  
  console.log(`[MESSAGE] Received from ${userId}: "${msg.text}" (type: ${typeof msg.text})`);
  
  // CRITICAL: Commands always take priority - clear bankroll state immediately
  if (msg.text && msg.text.startsWith('/')) {
    console.log(`[MESSAGE] Command detected: ${msg.text}`);
    // Clear awaiting_bankroll state for ANY command
    if (userBankrolls[userId] === 'awaiting_bankroll' || userBankrolls[userId] === 'awaiting_bankroll_update') {
      console.log(`[MESSAGE] Clearing awaiting_bankroll state for command`);
      delete userBankrolls[userId];
    }
    return; // Return immediately - let command handlers process
  }
  
  console.log(`[MESSAGE] Non-command message, bankroll state: ${userBankrolls[userId]}`);
  
  // Handle bankroll input for /start and /bankroll
  if (userBankrolls[userId] === 'awaiting_bankroll') {
    const validation = validateBankroll(msg.text);
    
    if (!validation.valid) {
      logger.warn('Invalid bankroll input received', {
        userId,
        input: msg.text,
        error: validation.error
      });
      bot.sendMessage(chatId, validation.error);
      return;
    }
    
    userBankrolls[userId] = validation.value;
    
    // Save bankroll to database for persistence
    try {
      await supabaseClient.upsertUser(userId, msg.from.username || `user_${userId}`);
      const { error } = await supabaseClient.supabase
        .from('users')
        .update({ bankroll: validation.value, updated_at: new Date() })
        .eq('telegram_id', userId);
      
      if (!error) {
        logger.info('Bankroll configured and saved', {
          userId,
          bankroll: validation.value,
          chatId
        });
        bot.sendMessage(chatId, `✅ Bankroll set to $${validation.value}\n\nNow use /scan to find gems!`);
      } else {
        logger.warn('Could not save bankroll to database:', error.message);
        bot.sendMessage(chatId, `✅ Bankroll set to $${validation.value} (local only)\n\nNow use /scan to find gems!`);
      }
    } catch (err) {
      logger.warn('Error saving bankroll:', err.message);
      bot.sendMessage(chatId, `✅ Bankroll set to $${validation.value}\n\nNow use /scan to find gems!`);
    }
  }
  // Handle bankroll update for /bankroll command
  else if (userBankrolls[userId] === 'awaiting_bankroll_update') {
    const validation = validateBankroll(msg.text);
    
    if (!validation.valid) {
      logger.warn('Invalid bankroll update received', {
        userId,
        input: msg.text,
        error: validation.error
      });
      bot.sendMessage(chatId, validation.error);
      return;
    }
    
    userBankrolls[userId] = validation.value;
    
    // Save updated bankroll to database
    try {
      const { error } = await supabaseClient.supabase
        .from('users')
        .update({ bankroll: validation.value, updated_at: new Date() })
        .eq('telegram_id', userId);
      
      if (!error) {
        logger.info('Bankroll updated by user', {
          userId,
          bankroll: validation.value,
          chatId
        });
        bot.sendMessage(chatId, `✅ Bankroll updated to $${validation.value}\n\nUse /scan to find gems!`);
      } else {
        logger.warn('Could not save bankroll to database:', error.message);
        bot.sendMessage(chatId, `✅ Bankroll updated to $${validation.value} (local only)`);
      }
    } catch (err) {
      logger.warn('Error updating bankroll:', err.message);
      bot.sendMessage(chatId, `✅ Bankroll updated to $${validation.value}`);
    }
  }
});

// Register /scan command
bot.onText(/\/scan/, async (msg) => {
  await scanHandler.handleScan(msg);
});

// Register /stats command
bot.onText(/^\/(stats?)\b/, (msg) => {
  statsHandler.handleStats(msg);
});

// Register /lite command
bot.onText(/\/lite/, (msg) => {
  utilsCommands.handleLite(msg);
});

// Register /alerts command
bot.onText(/\/alerts\s*(discord|slack)?\s*(.*)/, (msg, match) => {
  utilsCommands.handleAlerts(msg, match);
});

// Register /compare command
bot.onText(/\/compare\s+(.+?)\s+([+-]?\d+\.?\d*)/, async (msg, match) => {
  await utilsCommands.handleCompare(msg, match);
});

// Register /calculator command
bot.onText(/\/calculator/, (msg) => {
  utilsCommands.handleCalculator(msg);
});

// Register /api command
bot.onText(/\/api/, (msg) => {
  utilsCommands.handleAPI(msg);
});

// Register /bankroll command
bot.onText(/\/bankroll\s*(\d+)?/, async (msg, match) => {
  await bankrollHandler.handleBankroll(msg, match);
});

// Register /timezone command
bot.onText(/\/timezone/, async (msg) => {
  await timezoneHandler.handleTimezone(msg);
});

// Register /export command
bot.onText(/\/export/, async (msg) => {
  await exportHandler.handleExport(msg);
});

// Register /export_csv command
bot.onText(/\/export_csv/, async (msg) => {
  await exportHandler.handleExportCSV(msg);
});

// Register /export_txt command
bot.onText(/\/export_txt/, async (msg) => {
  await exportHandler.handleExportTXT(msg);
});

// Register /export_json command
bot.onText(/\/export_json/, async (msg) => {
  await exportHandler.handleExportJSON(msg);
});

// Register /status command
bot.onText(/\/status/, async (msg) => {
  await utilsCommands.handleStatus(msg);
});

// Register /terms command
bot.onText(/\/terms/, (msg) => {
  utilsCommands.handleTerms(msg);
});

// Register /support command
bot.onText(/\/support/, (msg) => {
  utilsCommands.handleSupport(msg);
});

// Register /paysupport command
bot.onText(/\/paysupport/, (msg) => {
  utilsCommands.handlePaySupport(msg);
});

// Register /help command
bot.onText(/\/help/, (msg) => {
  utilsCommands.handleHelp(msg);
});

// Register callback handlers
bot.on('callback_query', async (query) => {
  await callbackHandlers.handleCallbackQuery(query);
});

// Cleanup expired subscriptions every hour
cron.schedule('0 * * * *', async () => {
  try {
    const result = await supabaseClient.cleanupExpiredSubscriptions();
    if (result && result.deletedCount > 0) {
      logger.info(`🧹 Cleanup: Expired ${result.deletedCount} subscriptions`);
    }
  } catch (err) {
    logger.error('Cleanup job failed:', err.message);
  }
});

// Error handling
bot.on('polling_error', (err) => {
  console.error('[POLLING_ERROR]', err.message);
});

// Graceful shutdown handlers
process.on('SIGTERM', () => {
  console.log('[SHUTDOWN] SIGTERM received, stopping bot...');
  bot.stopPolling();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[SHUTDOWN] SIGINT received, stopping bot...');
  bot.stopPolling();
  process.exit(0);
});

console.log('✅ Bot running with Whop payment integration...');
console.log('📍 Subscribe: /subscribe');
console.log('🛒 Whop ready for payments');
