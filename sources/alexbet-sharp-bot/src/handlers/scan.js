/**
 * /scan command handler
 * Finds +EV gems with Claude AI edge detection
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const supabaseClient = require('../services/supabase-client');
const { getSubscriptionDetails } = require('../services/auth');
const RateLimiter = require('../services/rateLimiter');
const { retryWithBackoff } = require('../utils/retry-logic');
const { fetchRealGems } = require('../utils/gem-calculation');
const { parseDateTimeString } = require('../utils/date-parsing');
const { getSportEmoji } = require('../utils/formatting');

// These need to be passed in from the main file
let bot, isAdmin, userBankrolls, userTimezones, scanLimiter, claudeOptimizer, userLatestScans;

function setContext(botInstance, isAdminFn, bankrolls, timezones, limiter, optimizer, latestScans) {
  bot = botInstance;
  isAdmin = isAdminFn;
  userBankrolls = bankrolls;
  userTimezones = timezones;
  scanLimiter = limiter;
  claudeOptimizer = optimizer;
  userLatestScans = latestScans;
}

async function handleScan(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const userName = msg.from.username || 'anonymous';
  
  logger.info('User initiated /scan command', { userId, userName, chatId, isAdmin: isAdmin(userId) });
  
  // CHECK RATE LIMIT FIRST
  const rateLimitStatus = scanLimiter.isRateLimited(userId);
  if (rateLimitStatus.limited) {
    const waitTime = rateLimitStatus.secondsLeft;
    const userMsg = `⏱️ Rate limited! Please wait ${waitTime}s before next scan.\n\n📊 Limit: ${rateLimitStatus.maxRequests} scans per minute.`;
    bot.sendMessage(chatId, userMsg);
    logger.warn('User rate limited for /scan', { userId, waitTime, limit: rateLimitStatus.maxRequests });
    return; // Stop processing
  }
  
  // Get user's bankroll or use default
  let bankroll = userBankrolls[userId];
  
  // If not in memory, try to load from database (important for group usage)
  if (!bankroll || bankroll === 'awaiting_bankroll' || bankroll === 'awaiting_bankroll_update') {
    try {
      const { data: user } = await supabaseClient.getUser(userId);
      if (user && user.bankroll) {
        bankroll = user.bankroll;
        userBankrolls[userId] = bankroll;
        logger.info('Loaded bankroll from database for /scan', { userId, bankroll });
      } else {
        bankroll = 100; // Default fallback
        logger.debug('No bankroll in database, using default', { userId, bankroll });
      }
    } catch (err) {
      bankroll = 100; // Default fallback on error
      logger.warn('Could not load bankroll from database, using default', { userId, error: err.message });
    }
  }
  
  if (!bankroll || typeof bankroll !== 'number' || bankroll < 1) {
    bankroll = 100; // Final fallback
  }
  
  const timezone = userTimezones[userId] || 'America/New_York';
  
  // Check user subscription tier
  let subscription = { tier: 'admin', gems: 9999, allowedMarkets: ['ML', 'Spread', 'Total'] };
  
  // Admins bypass subscription checks
  if (!isAdmin(userId)) {
    subscription = { tier: 'free', gems: 3, allowedMarkets: ['ML'] };
    try {
      const subDetails = await getSubscriptionDetails(userId);
      const tierConfig = {
        'free': { gems: 3, allowedMarkets: ['ML'] },
        'monthly': { gems: 10, allowedMarkets: ['ML', 'Total'] },
        'monthly_plus': { gems: 30, allowedMarkets: ['ML', 'Spread', 'Total'] },
        'yearly': { gems: 20, allowedMarkets: ['ML', 'Spread', 'Total'] },
        'lifetime': { gems: 9999, allowedMarkets: ['ML', 'Spread', 'Total'] }
      };
      subscription = {
        tier: subDetails.tier || 'free',
        gems: tierConfig[subDetails.tier]?.gems || 3,
        allowedMarkets: tierConfig[subDetails.tier]?.allowedMarkets || ['moneyline']
      };
    } catch (err) {
      logger.warn('Failed to fetch subscription status, using free tier', { userId, error: err.message });
      subscription = { tier: 'free', gems: 3, allowedMarkets: ['moneyline'] };
    }
  }
  
  logger.info('Scan parameters loaded', { userId, bankroll, timezone, subscription: subscription.tier, maxGems: subscription.gems, allowedMarkets: subscription.allowedMarkets });
  
  bot.sendMessage(chatId, '🔄 Fetching live odds + Claude AI analysis...');
  const scanStartTime = Date.now();
  
  try {
    logger.debug('Fetching gems from Odds API', { userId, bankroll, timezone });
    
    // Fetch gems with exponential backoff (3 attempts: 1s, 2s, 4s)
    let gems;
    try {
      gems = await retryWithBackoff(
        () => fetchRealGems(bankroll, timezone),
        3,    // max attempts
        1000  // initial delay (1 second)
      );
    } catch (retryError) {
      logger.error('Gems fetch failed after all retry attempts', {
        userId,
        error: retryError.message
      });
      bot.sendMessage(
        chatId,
        `❌ Unable to fetch gems after 3 attempts.\n\nAPI may be overloaded. Please try again in a moment.`
      );
      return;
    }
    
    const fetchDuration = ((Date.now() - scanStartTime) / 1000).toFixed(3);
    
    if (!gems || gems.length === 0) {
      logger.warn('No gems found from API', { userId, fetchDuration });
      console.log('[DEBUG] fetchRealGems returned null or empty array');
      console.log('[DEBUG] This means no outcomes passed the EV threshold (> 0.2%)');
      bot.sendMessage(chatId, '⏳ No live games scheduled right now.\n\nTry again in a few hours.');
      return;
    }

    logger.info('Gems fetched from API', { userId, gemCount: gems.length, fetchDuration });

    // ✅ FIX: Filter gems by subscription tier's allowed markets
    // Free: only ML (Moneyline)
    // Monthly: ML + Totals
    // Yearly+: ML + Spreads + Totals
    const filteredGems = gems.filter(gem => subscription.allowedMarkets.includes(gem.market));
    const filteredCount = gems.length - filteredGems.length;
    
    if (filteredCount > 0) {
      logger.info('Gems filtered by subscription tier', { 
        userId, 
        tier: subscription.tier, 
        allowedMarkets: subscription.allowedMarkets,
        originalCount: gems.length, 
        filteredCount,
        remainingCount: filteredGems.length 
      });
    }
    
    if (filteredGems.length === 0) {
      logger.warn('No gems available after market filtering', { userId, tier: subscription.tier, allowedMarkets: subscription.allowedMarkets });
      bot.sendMessage(chatId, `⏳ No ${subscription.allowedMarkets.join('/')} opportunities right now.\n\nUpgrade your subscription for access to more markets: /subscribe`);
      return;
    }

    // Use Claude optimizer if available
    let analyzedGems = filteredGems;
    let claudeStats = null;
    if (claudeOptimizer) {
      logger.debug('Starting Claude AI analysis pipeline', { userId, gemCount: gems.length });
      analyzedGems = [];
      
      // Analyze top 10 games with Haiku → Sonnet → Opus pipeline
      for (const gem of gems.slice(0, 10)) {
        try {
          const isPremium = subscription.tier !== 'free';
          const analysis = await claudeOptimizer.analyzeGame(gem, isPremium);
          gem.claudeEdge = analysis.edge;
          gem.claudeConfidence = analysis.confidence;
          gem.claudeModel = analysis.model;
          analyzedGems.push(gem);
          logger.debug('Claude analysis complete for game', {
            userId,
            signal: gem.signal,
            edge: analysis.edge,
            model: analysis.model,
            confidence: analysis.confidence
          });
        } catch (err) {
          logger.warn('Claude analysis failed for game', {
            userId,
            signal: gem.signal,
            error: err.message
          });
          analyzedGems.push(gem);
        }
      }
      claudeStats = claudeOptimizer.getStats();
      logger.info('Claude analysis pipeline complete', { userId, gemsAnalyzed: analyzedGems.length, stats: claudeStats });
    } else {
      logger.warn('Claude optimizer not available, using raw edge data', { userId });
      analyzedGems = gems;
    }

    // Build market breakdown
    const h2hCount = analyzedGems.filter(gem => gem.market === 'ML').length;
    const spreadCount = analyzedGems.filter(gem => gem.market === 'Spread').length;
    const totalCount = analyzedGems.filter(gem => gem.market === 'Total').length;

    // Sort by Claude edge or original edge (primary), then by EV (secondary)
    const topGems = analyzedGems
      .sort((a, b) => {
        const edgeA = a.claudeEdge !== undefined ? a.claudeEdge : a.edge;
        const edgeB = b.claudeEdge !== undefined ? b.claudeEdge : b.edge;
        if (edgeB !== edgeA) return edgeB - edgeA; // Primary: higher edge first
        return b.ev - a.ev; // Tiebreaker: higher EV first
      })
      .slice(0, subscription.maxGems); // ✅ Apply tier-based gem limit (free: 3, monthly: 10, yearly: 20, lifetime: unlimited)
    
    // Group gems by sport
    const sportGroups = {};
    topGems.forEach(gem => {
      const sport = gem.league || gem.sport || 'Other';
      if (!sportGroups[sport]) sportGroups[sport] = [];
      sportGroups[sport].push(gem);
    });

    // Sort each sport group by game time (ascending)
    Object.keys(sportGroups).forEach(sport => {
      sportGroups[sport].sort((a, b) => {
        try {
          const timeA = parseDateTimeString(a.gameDate, a.gameTime);
          const timeB = parseDateTimeString(b.gameDate, b.gameTime);
          
          // Handle parsing errors
          if (isNaN(timeA.getTime()) || isNaN(timeB.getTime())) {
            console.warn('[SORT WARNING] Invalid date parsing for', { 
              a: `${a.gameDate} ${a.gameTime}`, 
              b: `${b.gameDate} ${b.gameTime}` 
            });
            return 0; // Don't change order if parsing fails
          }
          
          return timeA - timeB;
        } catch (err) {
          console.error('[SORT ERROR]', err.message, { 
            aDate: a.gameDate, 
            aTime: a.gameTime,
            bDate: b.gameDate,
            bTime: b.gameTime
          });
          return 0; // Don't change order on error
        }
      });
    });

    // Flatten sport groups back to ordered array, maintaining sport grouping + time order
    const orderedGems = [];
    const sortedSports = Object.keys(sportGroups).sort();
    sortedSports.forEach(sport => {
      orderedGems.push(...sportGroups[sport]);
    });

    // Calculate summary stats FIRST
    const topGem = topGems[0];
    const topGemDisplay = topGem ? `${topGem.signal} @ ${topGem.odds > 0 ? '+' : ''}${topGem.odds}` : 'N/A';
    
    const avgEdge = (topGems.reduce((sum, g) => sum + g.edge, 0) / topGems.length).toFixed(2);
    const avgConfidence = Math.round(topGems.reduce((sum, g) => {
      const edgeConf = Math.min(90, Math.max(35, Math.round(50 + (Math.abs(g.edge) * 6))));
      const evBonus = g.ev > 5 ? 8 : g.ev > 2 ? 4 : 0;
      const consensusBonus = g.booksCompared >= 5 ? 12 : g.booksCompared >= 3 ? 8 : 0;
      return sum + Math.min(95, edgeConf + evBonus + consensusBonus);
    }, 0) / topGems.length);
    
    // Build SUMMARY CARD at the top
    let mainMsg = `🎯 *SCAN SUMMARY*\n\n` +
      `Total Gems: *${gems.length}* | Avg Edge: *+${avgEdge}%* | Confidence: *${avgConfidence}%*\n` +
      `💰 Moneylines: ${h2hCount} | 📊 Spreads: ${spreadCount} | 📈 Totals: ${totalCount}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    
    // Add all gems to ONE CARD
    orderedGems.forEach((gem) => {
      const displayEdge = gem.edge;
      const edgeConfidence = Math.min(90, Math.max(35, Math.round(50 + (Math.abs(displayEdge) * 6))));
      const evBonus = gem.ev > 5 ? 8 : gem.ev > 2 ? 4 : 0;
      const consensusBonus = gem.booksCompared >= 5 ? 12 : gem.booksCompared >= 3 ? 8 : 0;
      const confidence = Math.min(95, edgeConfidence + evBonus + consensusBonus);
      
      const gameDate = gem.gameDate ? gem.gameDate : 'TBD';
      const gameTime = gem.gameTime ? gem.gameTime : 'TBD';
      
      // Game info at top, then pick details
      mainMsg += `${gem.game}\n`;
      mainMsg += `${gameDate} @ ${gameTime}\n\n`;
      mainMsg += `${getSportEmoji(gem.sport)} *${gem.betType}* → *${gem.signal}* @ ${gem.odds > 0 ? '+' : ''}${gem.odds}\\n`;
      mainMsg += `⚡ Edge: +${displayEdge}% | 🎯 Confidence: ${confidence}% | 📈 EV: +${gem.ev}%\n`;
      mainMsg += `💰 Kelly: $${gem.kelly} | Conservative: $${gem.conservative.two}\n`;
      mainMsg += `📊 ${gem.book} (${gem.booksCompared} books)\n\n`;
    });
    
    // Send main card with gems
    bot.sendMessage(chatId, mainMsg, { parse_mode: 'Markdown' });
    
    // Send divider image (optional - if file exists)
    const dividerPath = path.join(__dirname, '../../assets/divider.png');
    if (fs.existsSync(dividerPath)) {
      try {
        bot.sendPhoto(chatId, dividerPath);
      } catch (err) {
        logger.warn('Could not send divider image', { error: err.message });
      }
    }
    
    // Send footer card asking for CSV export
    const summaryMsg = `\n📥 *EXPORT YOUR PICKS*\n\n` +
      `Download all scans in CSV format:\n` +
      `/export_csv`;
    bot.sendMessage(chatId, summaryMsg);
    
    // Store latest gems for export functionality
    userLatestScans[userId] = {
      gems: topGems,
      timestamp: Date.now(),
      count: gems.length,
      date: new Date().toISOString()
    };
    logger.info('Scan results stored for export', { userId, gemsCount: topGems.length });
  } catch (err) {
    logger.error('Scan execution failed', {
      userId,
      error: err.message,
      stack: err.stack
    });
    
    // Provide helpful context about the error
    const isNetworkError = err.message.includes('ECONNREFUSED') || 
                          err.message.includes('ENOTFOUND') || 
                          err.message.includes('ETIMEDOUT');
    const isRateLimitError = err.message.includes('429') || 
                            err.message.includes('rate limit');
    const isTimeoutError = err.message.includes('timeout') || 
                          err.message.includes('5 second');
    
    let errorContext = 'An error occurred while scanning odds';
    let suggestion = 'Try again in a few minutes.';
    
    if (isNetworkError) {
      errorContext = '🔌 Network connection failed';
      suggestion = 'Check your connection and try again.';
    } else if (isRateLimitError) {
      errorContext = '⚡ API rate limit exceeded';
      suggestion = 'The API is overloaded. Wait a few minutes.';
    } else if (isTimeoutError) {
      errorContext = '⏱️ Request timed out';
      suggestion = 'API is slow. Try again in 30 seconds.';
    } else if (err.message.includes('Failed after')) {
      errorContext = '🔄 API unreliable';
      suggestion = 'Multiple retries failed. Try again later.';
    }
    
    logger.error('Contextual error info', {
      userId,
      isNetworkError,
      isRateLimitError,
      isTimeoutError,
      fullError: err.message
    });
    
    bot.sendMessage(chatId, `❌ ${errorContext}\n\n${suggestion}`);
  }
}

module.exports = {
  handleScan,
  setContext
};
