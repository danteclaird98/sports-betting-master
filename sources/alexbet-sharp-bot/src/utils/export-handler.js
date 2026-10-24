/**
 * Export Handler - Convert scan results to CSV/TXT files
 * Saves the latest +EV scan results to downloadable formats
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// Create exports directory if it doesn't exist
const EXPORTS_DIR = path.join(__dirname, '../../exports');
if (!fs.existsSync(EXPORTS_DIR)) {
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });
}

/**
 * Format a single gem for export
 * Works with both API format and bot format
 */
function formatGem(gem, index) {
  // Helper to safely convert to number
  const toNumber = (val) => {
    if (typeof val === 'string') return parseFloat(val);
    return val;
  };
  
  return {
    rank: index + 1,
    sport: gem.sport || 'N/A',
    market: gem.market || gem.betType || 'N/A',
    signal: gem.signal || 'N/A',
    odds: gem.odds || 'N/A',
    edge_percent: (gem.edge_percent || gem.edge) ? toNumber(gem.edge_percent || gem.edge).toFixed(2) : 'N/A',
    ev_percent: (gem.ev_percent || gem.ev) ? toNumber(gem.ev_percent || gem.ev).toFixed(2) : 'N/A',
    implied_probability: gem.implied_probability ? toNumber(gem.implied_probability).toFixed(2) : 'N/A',
    kelly_percent: (gem.kelly_percent || gem.kelly) ? (toNumber(gem.kelly_percent || gem.kelly) / 100).toFixed(2) : 'N/A',
    kelly_stake: gem.kelly_stake || gem.kelly || 'N/A',
    conservative_2pct: gem.conservative_stake_2pct || 'N/A',
    game_date: gem.game_date || gem.gameDate || 'N/A',
    game_time: gem.game_time || gem.gameTime || 'N/A',
    game: gem.game || 'N/A',
    best_book: gem.best_book || gem.book || 'N/A',
    books_compared: gem.books_compared || 5
  };
}

/**
 * Export scan results to CSV format
 * @param {Array} gems - Array of gem objects from /scan
 * @param {number} userId - User ID for filename
 * @returns {Object} {filepath, filename, size}
 */
function exportToCSV(gems, userId) {
  try {
    if (!gems || gems.length === 0) {
      throw new Error('No gems to export');
    }

    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `alexbet-scan-${userId}-${timestamp}.csv`;
    const filepath = path.join(EXPORTS_DIR, filename);

    // Format gems
    const formattedGems = gems.map((gem, index) => formatGem(gem, index));

    // CSV headers
    const headers = Object.keys(formattedGems[0]);
    
    // Build CSV content
    let csv = headers.join(',') + '\n';
    
    formattedGems.forEach(gem => {
      const row = headers.map(header => {
        const value = gem[header];
        // Escape quotes and wrap in quotes if contains comma
        if (value && value.toString().includes(',')) {
          return `"${value.toString().replace(/"/g, '""')}"`;
        }
        return value;
      }).join(',');
      csv += row + '\n';
    });

    // Write to file
    fs.writeFileSync(filepath, csv, 'utf8');
    
    const fileSize = fs.statSync(filepath).size;
    logger.info('CSV export created', {
      userId,
      filename,
      gemsCount: gems.length,
      fileSize
    });

    return {
      filepath,
      filename,
      size: fileSize,
      gemsCount: gems.length,
      format: 'csv'
    };
  } catch (err) {
    logger.error('CSV export failed', { userId, error: err.message });
    throw err;
  }
}

/**
 * Export scan results to TXT format (human-readable)
 * @param {Array} gems - Array of gem objects from /scan
 * @param {number} userId - User ID for filename
 * @param {string} scanTimestamp - Optional ISO timestamp of when scan was run
 * @returns {Object} {filepath, filename, size}
 */
function exportToTXT(gems, userId, scanTimestamp) {
  try {
    if (!gems || gems.length === 0) {
      throw new Error('No signals to export');
    }

    const timestamp = new Date().toISOString();
    const filename = `alexbet-scan-${userId}-${timestamp.split('T')[0]}.txt`;
    const filepath = path.join(EXPORTS_DIR, filename);

    // Format signals
    const formattedSignals = gems.map((gem, index) => formatGem(gem, index));

    // Use scan timestamp if provided, otherwise use current time
    // Display in UTC to match scan source
    const displayTime = scanTimestamp ? new Date(scanTimestamp) : new Date();
    const timeStr = displayTime.toISOString().replace('T', ' ').substring(0, 19);
    const [datePart, timePart] = timeStr.split(' ');
    const [year, month, day] = datePart.split('-');
    const formattedDateTime = `${month}/${day}/${year}, ${timePart} UTC`;

    // Build TXT content
    let txt = '';
    txt += '╔════════════════════════════════════════════════════════════════════════╗\n';
    txt += '║            AlexBET SIGNAL PRO - +EV SCAN RESULTS                       ║\n';
    txt += `║             Generated: ${formattedDateTime.padEnd(24)} ║\n`;
    txt += '╚════════════════════════════════════════════════════════════════════════╝\n\n';

    txt += `📊 SUMMARY\n`;
    txt += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
    txt += `Total Signals Found: ${formattedSignals.length}\n`;
    txt += `Export Date: ${timestamp.split('T')[0]}\n`;
    txt += `Export Time: ${timestamp.split('T')[1].split('.')[0]}\n\n`;

    // Group by sport
    const bySport = {};
    formattedSignals.forEach(gem => {
      if (!bySport[gem.sport]) {
        bySport[gem.sport] = [];
      }
      bySport[gem.sport].push(gem);
    });

    txt += `📈 BREAKDOWN BY SPORT\n`;
    txt += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
    Object.entries(bySport).forEach(([sport, items]) => {
      const count = items.length;
      const label = count === 1 ? 'signal' : 'signals';
      txt += `${sport}: ${count} ${label}\n`;
    });
    txt += '\n\n';

    // Detailed results
    txt += `💎 DETAILED RESULTS (Ranked by Edge %)\n`;
    txt += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';

    formattedSignals.forEach((gem, index) => {
      // Box width is 67 chars (including borders). Content width is 65 chars.
      // Format: │ <65 chars> │
      const rankHeader = `#${gem.rank}`;
      const dashes = '─'.repeat(65 - 2 - rankHeader.length); // 2 = " " + " " around rank
      
      txt += `┌─ ${rankHeader} ${dashes}┐\n`;
      
      // Helper to pad line to exactly 65 chars
      const padLine = (str) => str.padEnd(65);
      
      // Line 1: Sport | Market | Signal (truncated to fit)
      const sport = (gem.sport || 'N/A').substring(0, 5);
      const market = (gem.market || 'N/A').substring(0, 9);
      const signal = (gem.signal || 'N/A').substring(0, 44);
      txt += `│ ${padLine(`Sport: ${sport} | Market: ${market} | ${signal}`)} │\n`;
      
      // Line 2: Odds | Book | Books count
      const odds = gem.odds ? gem.odds.toString().substring(0, 7) : 'N/A';
      const book = (gem.best_book || 'N/A').substring(0, 13);
      const booksCount = gem.books_compared || 5;
      txt += `│ ${padLine(`Odds: ${odds} | Book: ${book} | Books: ${booksCount}`)} │\n`;
      
      // Line 3: Edge | EV
      const edge = gem.edge_percent || 'N/A';
      const ev = gem.ev_percent || 'N/A';
      txt += `│ ${padLine(`Edge: ${edge}% | EV: ${ev}%`)} │\n`;
      
      // Line 4: Kelly | Implied
      const kelly = gem.kelly_percent || 'N/A';
      const kellyStake = gem.kelly_stake || 'N/A';
      const implied = gem.implied_probability || 'N/A';
      txt += `│ ${padLine(`Kelly: ${kelly}% (${kellyStake}) | Implied: ${implied}%`)} │\n`;
      
      // Line 5: Conservative 2%
      const conservative = gem.conservative_2pct || 'N/A';
      txt += `│ ${padLine(`Conservative 2%: ${conservative}`)} │\n`;
      
      txt += `└${'─'.repeat(65)}┘\n\n`;
    });

    txt += '\n';
    txt += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
    txt += '💡 KELLY SIZING GUIDE\n';
    txt += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
    txt += 'Kelly Criterion suggests the optimal bet size based on edge.\n';
    txt += 'Conservative 2% = Same expected value with lower variance.\n';
    txt += 'Start with 2% and increase as bankroll grows.\n\n';
    txt += 'Questions? Email: support@alexbet.io\n';
    txt += 'Subscribe for more: https://whop.com/alexbet/\n';

    // Write to file
    fs.writeFileSync(filepath, txt, 'utf8');
    
    const fileSize = fs.statSync(filepath).size;
    logger.info('TXT export created', {
      userId,
      filename,
      gemsCount: gems.length,
      fileSize
    });

    return {
      filepath,
      filename,
      size: fileSize,
      gemsCount: gems.length,
      format: 'txt'
    };
  } catch (err) {
    logger.error('TXT export failed', { userId, error: err.message });
    throw err;
  }
}

/**
 * Export scan results to JSON format
 * @param {Array} gems - Array of gem objects from /scan
 * @param {number} userId - User ID for filename
 * @returns {Object} {filepath, filename, size}
 */
function exportToJSON(gems, userId) {
  try {
    if (!gems || gems.length === 0) {
      throw new Error('No gems to export');
    }

    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `alexbet-scan-${userId}-${timestamp}.json`;
    const filepath = path.join(EXPORTS_DIR, filename);

    const formattedGems = gems.map((gem, index) => formatGem(gem, index));

    const json = {
      metadata: {
        exportDate: new Date().toISOString(),
        userId: userId,
        totalGems: formattedGems.length,
        version: '2.0'
      },
      gems: formattedGems,
      summary: {
        totalGemsFound: formattedGems.length,
        avgEdge: (formattedGems.reduce((sum, g) => sum + parseFloat(g.edge_percent), 0) / formattedGems.length).toFixed(2),
        sports: [...new Set(formattedGems.map(g => g.sport))]
      }
    };

    fs.writeFileSync(filepath, JSON.stringify(json, null, 2), 'utf8');
    
    const fileSize = fs.statSync(filepath).size;
    logger.info('JSON export created', {
      userId,
      filename,
      gemsCount: gems.length,
      fileSize
    });

    return {
      filepath,
      filename,
      size: fileSize,
      gemsCount: gems.length,
      format: 'json'
    };
  } catch (err) {
    logger.error('JSON export failed', { userId, error: err.message });
    throw err;
  }
}

/**
 * Get list of available exports for user
 * @param {number} userId - User ID
 * @returns {Array} List of available files
 */
function getAvailableExports(userId) {
  try {
    const files = fs.readdirSync(EXPORTS_DIR);
    const userFiles = files.filter(f => f.includes(`-${userId}-`));
    
    return userFiles.map(filename => {
      const filepath = path.join(EXPORTS_DIR, filename);
      const stats = fs.statSync(filepath);
      return {
        filename,
        size: stats.size,
        sizeKB: (stats.size / 1024).toFixed(2),
        created: stats.birthtime,
        modified: stats.mtime
      };
    }).sort((a, b) => b.modified - a.modified);
  } catch (err) {
    logger.error('Failed to get available exports', { userId, error: err.message });
    return [];
  }
}

/**
 * Clean up old exports (older than 7 days)
 */
function cleanupOldExports(maxAgeDays = 7) {
  try {
    const files = fs.readdirSync(EXPORTS_DIR);
    const now = Date.now();
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

    let deletedCount = 0;
    files.forEach(filename => {
      const filepath = path.join(EXPORTS_DIR, filename);
      const stats = fs.statSync(filepath);
      const age = now - stats.mtime.getTime();

      if (age > maxAgeMs) {
        fs.unlinkSync(filepath);
        deletedCount++;
      }
    });

    if (deletedCount > 0) {
      logger.info('Cleaned up old exports', { deletedCount });
    }
  } catch (err) {
    logger.error('Failed to cleanup old exports', { error: err.message });
  }
}

module.exports = {
  exportToCSV,
  exportToTXT,
  exportToJSON,
  getAvailableExports,
  cleanupOldExports,
  EXPORTS_DIR
};
