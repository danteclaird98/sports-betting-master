/**
 * Export handlers (/export, /export_csv, /export_txt, /export_json)
 * Consolidates all export variants
 */

const fs = require('fs');
const logger = require('../utils/logger');
const supabaseClient = require('../services/supabase-client');
const { getSubscriptionDetails } = require('../services/auth');
const { exportToCSV, exportToTXT, exportToJSON } = require('../utils/export-handler');

let bot, isAdmin, userLatestScans, exportLimiter;

function setContext(botInstance, isAdminFn, latestScans, limiter) {
  bot = botInstance;
  isAdmin = isAdminFn;
  userLatestScans = latestScans;
  exportLimiter = limiter;
}

async function handleExport(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // CHECK RATE LIMIT FIRST
  const rateLimitResult = exportLimiter.isRateLimited(userId);
  if (rateLimitResult.limited) {
    const msg_text = `⏳ Too many exports. You have 5 exports per minute.\n\nTry again in ${rateLimitResult.secondsLeft}s`;
    return bot.sendMessage(chatId, msg_text);
  }

  try {
    // Admins bypass subscription check
    if (!isAdmin(userId)) {
      const subscription = await getSubscriptionDetails(userId);
      
      if (!subscription.export) {
        bot.sendMessage(chatId, `❌ Export feature is premium only.\\n\\n/subscribe to unlock:\\n  • Unlimited gems\\n  • CSV/JSON/PDF export\\n  • Full market access (Spreads, Totals)\\n  • Advanced statistics`);
        return;
      }
    }
    
    // Ensure user exists in database
    await supabaseClient.upsertUser(userId, msg.from.username || `user_${userId}`);
    
    // Check if user has recent scan
    const userScans = userLatestScans[userId];
    if (!userScans || !userScans.gems || userScans.gems.length === 0) {
      bot.sendMessage(chatId, `❌ No recent scan found.\\n\\nRun /scan first, then export the results.`);
      return;
    }

    const message = `📊 Export Your Latest Scan\n\nYou have ${userScans.gems.length} signals from ${new Date(userScans.date).toLocaleString()}\n\nChoose format:\n\n/export_txt - Download as TXT (recommended)\n/export_csv - Download as CSV (Excel)\n/export_json - Download as JSON (backup)`;
    bot.sendMessage(chatId, message);
  } catch (err) {
    logger.error('Error in /export:', err);
    bot.sendMessage(chatId, '❌ Error preparing export. Please try again.');
  }
}

async function handleExportCSV(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // CHECK RATE LIMIT FIRST
  const rateLimitResult = exportLimiter.isRateLimited(userId);
  if (rateLimitResult.limited) {
    const msg_text = `⏳ Too many exports. You have 5 exports per minute.\n\nTry again in ${rateLimitResult.secondsLeft}s`;
    return bot.sendMessage(chatId, msg_text);
  }

  try {
    // Check subscription (admins bypass)
    if (!isAdmin(userId)) {
      const subscription = await getSubscriptionDetails(userId);
      if (!subscription.export) {
        bot.sendMessage(chatId, `❌ CSV export is premium only.\\n\\n/subscribe to unlock CSV, JSON, and PDF exports`);
        return;
      }
    }
    
    // Check if user has recent scan
    const userScans = userLatestScans[userId];
    if (!userScans || !userScans.gems || userScans.gems.length === 0) {
      bot.sendMessage(chatId, `❌ No recent scan found.\\n\\nRun /scan first, then export.`);
      return;
    }

    // Apply gem limit (admins get all gems)
    let maxGems = 10;
    if (isAdmin(userId)) {
      maxGems = 9999; // Admins get unlimited
    } else {
      const subscription = await getSubscriptionDetails(userId);
      maxGems = subscription.gems || 10;
    }
    
    let gemsToExport = userScans.gems.slice(0, maxGems);
    if (userScans.gems.length > maxGems && !isAdmin(userId)) {
      const subscription = await getSubscriptionDetails(userId);
      bot.sendMessage(chatId, `⚠️ ${subscription.tier} tier limited to ${maxGems} signals. /subscribe for more`);
    }

    // Convert gems to export format
    const gems = gemsToExport.map(gem => ({
      sport: gem.sport || 'N/A',
      market: gem.betType || 'N/A',
      signal: gem.signal || 'N/A',
      odds: gem.odds || 'N/A',
      edge_percent: gem.edge ? gem.edge.toFixed(2) : 'N/A',
      ev_percent: gem.ev ? gem.ev.toFixed(2) : 'N/A',
      kelly_stake: gem.kelly || 'N/A',
      game: gem.game || 'N/A',
      game_date: gem.gameDate || 'N/A',
      game_time: gem.gameTime || 'N/A'
    }));

    // Create CSV
    const result = exportToCSV(gems, userId);
    
    // Send the actual file to Telegram using fs.createReadStream
    const fileStream = fs.createReadStream(result.filepath);
    
    bot.sendDocument(chatId, fileStream, {
      caption: `📊 CSV Export\\n\\n📥 File: ${result.filename}\\n💾 Size: ${(result.size / 1024).toFixed(2)} KB\\n✅ ${result.gemsCount} signals exported`,
      filename: result.filename
    }, (err) => {
      if (err) {
        logger.error('Failed to send CSV file', { userId, error: err.message });
        bot.sendMessage(chatId, `❌ Failed to send file: ${err.message}`);
      } else {
        logger.info('CSV file sent to user', { userId, filename: result.filename });
      }
    });
  } catch (err) {
    logger.error('CSV export error', { userId, error: err.message });
    bot.sendMessage(chatId, `❌ Export failed: ${err.message}`);
  }
}

async function handleExportTXT(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // CHECK RATE LIMIT FIRST
  const rateLimitResult = exportLimiter.isRateLimited(userId);
  if (rateLimitResult.limited) {
    const msg_text = `⏳ Too many exports. You have 5 exports per minute.\n\nTry again in ${rateLimitResult.secondsLeft}s`;
    return bot.sendMessage(chatId, msg_text);
  }

  try {
    // Check subscription (admins bypass)
    if (!isAdmin(userId)) {
      const subscription = await getSubscriptionDetails(userId);
      if (!subscription.export) {
        bot.sendMessage(chatId, `❌ Text export is premium only.\\n\\n/subscribe to unlock CSV, JSON, and PDF exports`);
        return;
      }
    }
    
    // Check if user has recent scan
    const userScans = userLatestScans[userId];
    if (!userScans || !userScans.gems || userScans.gems.length === 0) {
      bot.sendMessage(chatId, `❌ No recent scan found.\\n\\nRun /scan first, then export.`);
      return;
    }

    // Apply gem limit (admins get all gems)
    let maxGems = 10;
    if (isAdmin(userId)) {
      maxGems = 9999; // Admins get unlimited
    } else {
      const subscription = await getSubscriptionDetails(userId);
      maxGems = subscription.gems || 10;
    }
    
    let gemsToExport = userScans.gems.slice(0, maxGems);
    if (userScans.gems.length > maxGems && !isAdmin(userId)) {
      const subscription = await getSubscriptionDetails(userId);
      bot.sendMessage(chatId, `⚠️ ${subscription.tier} tier limited to ${maxGems} signals. /subscribe for more`);
    }

    // Convert gems to export format
    const gems = gemsToExport.map(gem => ({
      sport: gem.sport || 'N/A',
      market: gem.betType || 'N/A',
      signal: gem.signal || 'N/A',
      odds: gem.odds || 'N/A',
      edge_percent: gem.edge ? gem.edge.toFixed(2) : 'N/A',
      ev_percent: gem.ev ? gem.ev.toFixed(2) : 'N/A',
      kelly_percent: gem.kelly ? (gem.kelly / 100).toFixed(2) : 'N/A',
      kelly_stake: gem.kelly || 'N/A',
      game: gem.game || 'N/A',
      game_time: gem.gameTime || 'N/A',
      best_book: gem.book || 'N/A',
      books_compared: 5
    }));

    // Create TXT
    const result = exportToTXT(gems, userId, userScans.date);
    
    // Send the actual file to Telegram using fs.createReadStream
    const fileStream = fs.createReadStream(result.filepath);
    
    bot.sendDocument(chatId, fileStream, {
      caption: `📋 TXT Export\\n\\n📥 File: ${result.filename}\\n💾 Size: ${(result.size / 1024).toFixed(2)} KB\\n✅ ${result.gemsCount} signals exported`,
      filename: result.filename
    }, (err) => {
      if (err) {
        logger.error('Failed to send TXT file', { userId, error: err.message });
        bot.sendMessage(chatId, `❌ Failed to send file: ${err.message}`);
      } else {
        logger.info('TXT file sent to user', { userId, filename: result.filename });
      }
    });
  } catch (err) {
    logger.error('TXT export error', { userId, error: err.message });
    bot.sendMessage(chatId, `❌ Export failed: ${err.message}`);
  }
}

async function handleExportJSON(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // CHECK RATE LIMIT FIRST
  const rateLimitResult = exportLimiter.isRateLimited(userId);
  if (rateLimitResult.limited) {
    const msg_text = `⏳ Too many exports. You have 5 exports per minute.\n\nTry again in ${rateLimitResult.secondsLeft}s`;
    return bot.sendMessage(chatId, msg_text);
  }

  try {
    // Check subscription (admins bypass)
    if (!isAdmin(userId)) {
      const subscription = await getSubscriptionDetails(userId);
      if (!subscription.export) {
        bot.sendMessage(chatId, `❌ JSON export is premium only.\\n\\n/subscribe to unlock CSV, JSON, and PDF exports`);
        return;
      }
    }
    
    // Check if user has recent scan
    const userScans = userLatestScans[userId];
    if (!userScans || !userScans.gems || userScans.gems.length === 0) {
      bot.sendMessage(chatId, `❌ No recent scan found.\\n\\nRun /scan first, then export.`);
      return;
    }

    // Apply gem limit (admins get all gems)
    let maxGems = 10;
    if (isAdmin(userId)) {
      maxGems = 9999; // Admins get unlimited
    } else {
      const subscription = await getSubscriptionDetails(userId);
      maxGems = subscription.gems || 10;
    }
    
    let gemsToExport = userScans.gems.slice(0, maxGems);
    if (userScans.gems.length > maxGems && !isAdmin(userId)) {
      const subscription = await getSubscriptionDetails(userId);
      bot.sendMessage(chatId, `⚠️ ${subscription.tier} tier limited to ${maxGems} signals. /subscribe for more`);
    }

    // Convert gems to export format
    const gems = gemsToExport.map(gem => ({
      sport: gem.sport || 'N/A',
      market: gem.betType || 'N/A',
      signal: gem.signal || 'N/A',
      odds: gem.odds || 'N/A',
      edge_percent: gem.edge ? gem.edge.toFixed(2) : 'N/A',
      ev_percent: gem.ev ? gem.ev.toFixed(2) : 'N/A',
      kelly_stake: gem.kelly || 'N/A',
      game: gem.game || 'N/A',
      game_date: gem.gameDate || 'N/A',
      game_time: gem.gameTime || 'N/A'
    }));

    // Create JSON
    const result = exportToJSON(gems, userId);
    
    // Send the actual file to Telegram using fs.createReadStream
    const fileStream = fs.createReadStream(result.filepath);
    
    bot.sendDocument(chatId, fileStream, {
      caption: `📄 JSON Export\\n\\n📥 File: ${result.filename}\\n💾 Size: ${(result.size / 1024).toFixed(2)} KB\\n✅ ${result.gemsCount} signals exported (with metadata)`,
      filename: result.filename
    }, (err) => {
      if (err) {
        logger.error('Failed to send JSON file', { userId, error: err.message });
        bot.sendMessage(chatId, `❌ Failed to send file: ${err.message}`);
      } else {
        logger.info('JSON file sent to user', { userId, filename: result.filename });
      }
    });
  } catch (err) {
    logger.error('JSON export error', { userId, error: err.message });
    bot.sendMessage(chatId, `❌ Export failed: ${err.message}`);
  }
}

module.exports = {
  handleExport,
  handleExportCSV,
  handleExportTXT,
  handleExportJSON,
  setContext
};
