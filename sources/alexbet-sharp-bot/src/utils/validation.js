/**
 * Enhanced error handling and validation utilities for AlexBET Bot
 */

const logger = require('./logger');

/**
 * Validate bankroll input
 * @param {number} bankroll - Amount to validate
 * @returns {Object} {valid: boolean, error?: string, value?: number}
 */
function validateBankroll(bankroll) {
  const parsed = parseInt(bankroll);
  
  if (isNaN(parsed)) {
    return {
      valid: false,
      error: '❌ Invalid amount. Please enter a number (e.g., 100)'
    };
  }
  
  if (parsed < 1) {
    return {
      valid: false,
      error: '❌ Minimum bankroll is $1'
    };
  }
  
  if (parsed > 1000000) {
    return {
      valid: false,
      error: '❌ Maximum bankroll is $1,000,000'
    };
  }
  
  logger.debug('Bankroll validated', { bankroll: parsed });
  return { valid: true, value: parsed };
}

/**
 * Validate timezone
 * @param {string} timezone - IANA timezone string
 * @returns {Object} {valid: boolean, error?: string}
 */
function validateTimezone(timezone) {
  const validTimezones = [
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'America/Anchorage',
    'Pacific/Honolulu',
    'UTC'
  ];
  
  if (!timezone || !validTimezones.includes(timezone)) {
    return {
      valid: false,
      error: '❌ Invalid timezone. Valid options: ' + validTimezones.join(', ')
    };
  }
  
  logger.debug('Timezone validated', { timezone });
  return { valid: true };
}

/**
 * Handle API response with validation
 * @param {string} data - Raw response data
 * @param {string} sport - Sport identifier
 * @param {string} market - Market type
 * @returns {Object} {success: boolean, games?: Array, error?: string}
 */
function parseAPIResponse(data, sport, market) {
  try {
    if (!data || data.length === 0) {
      logger.warn('Empty API response', { sport, market });
      return { success: true, games: [], source: sport + ':' + market };
    }
    
    let games;
    try {
      games = JSON.parse(data) || [];
    } catch (parseErr) {
      logger.error('JSON parse error', {
        sport,
        market,
        error: parseErr.message,
        responseLength: data.length,
        firstChars: data.substring(0, 100)
      });
      return {
        success: false,
        error: `JSON parse error for ${sport} ${market}`,
        source: sport + ':' + market
      };
    }
    
    // Check if API returned an error
    if (games.error) {
      logger.warn('API error response', { sport, market, error: games.error });
      return {
        success: false,
        error: games.error,
        source: sport + ':' + market
      };
    }
    
    logger.debug('Successfully parsed API response', {
      sport,
      market,
      gameCount: games.length
    });
    
    return { success: true, games, source: sport + ':' + market };
  } catch (err) {
    logger.error('Unexpected error parsing API response', {
      sport,
      market,
      error: err.message
    });
    return {
      success: false,
      error: 'Unexpected error parsing response',
      source: sport + ':' + market
    };
  }
}

/**
 * Make HTTPS request with timeout
 * @param {string} url - URL to fetch
 * @param {number} timeout - Timeout in milliseconds (default: 10000)
 * @returns {Promise<Object>} {success: boolean, data?: string, error?: string}
 */
function makeHTTPSRequest(url, timeout = 10000) {
  return new Promise((resolve) => {
    const https = require('https');
    let timedOut = false;
    
    try {
      const req = https.get(url, (res) => {
        let data = '';
        
        res.on('data', chunk => {
          data += chunk;
        });
        
        res.on('end', () => {
          if (!timedOut) {
            resolve({ success: true, data });
          }
        });
      });
      
      // Handle timeout
      req.setTimeout(timeout, () => {
        timedOut = true;
        req.destroy();
        logger.warn('HTTP request timeout', { url, timeout });
        resolve({
          success: false,
          error: 'Request timeout',
          url
        });
      });
      
      // Handle connection errors
      req.on('error', (err) => {
        if (!timedOut) {
          logger.error('HTTP request error', {
            url,
            error: err.message,
            code: err.code
          });
          resolve({
            success: false,
            error: err.message,
            url
          });
        }
      });
    } catch (err) {
      logger.error('Failed to create HTTP request', {
        url,
        error: err.message
      });
      resolve({
        success: false,
        error: err.message,
        url
      });
    }
  });
}

module.exports = {
  validateBankroll,
  validateTimezone,
  parseAPIResponse,
  makeHTTPSRequest
};
