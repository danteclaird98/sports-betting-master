/**
 * Rate Limiter Service
 * Tracks user requests and enforces rate limits
 * 
 * Usage:
 * const limiter = new RateLimiter(10, 60000); // 10 requests per 60 seconds
 * const limited = limiter.isRateLimited(userId);
 * if (limited.limited) {
 *   // User exceeded limit, tell them to wait
 * }
 */

const logger = require('../utils/logger');

class RateLimiter {
  constructor(maxRequests = 10, windowMs = 60000) {
    /**
     * @param {number} maxRequests - Max requests allowed per window (default: 10)
     * @param {number} windowMs - Time window in milliseconds (default: 60000 = 1 minute)
     */
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.requests = new Map(); // userId -> { count, resetTime }
    
    logger.info('RateLimiter initialized', {
      maxRequests,
      windowMs,
      windowSeconds: windowMs / 1000
    });
  }

  /**
   * Check if user is rate limited
   * @param {string|number} userId - Unique user identifier
   * @returns {Object|boolean} 
   *   - false if request is allowed
   *   - {limited: true, secondsLeft, maxRequests} if limited
   */
  isRateLimited(userId) {
    const now = Date.now();
    let userRecord = this.requests.get(userId);

    // Initialize or reset if window expired
    if (!userRecord || now > userRecord.resetTime) {
      this.requests.set(userId, {
        count: 1,
        resetTime: now + this.windowMs
      });
      return false;
    }

    // Check if user exceeded limit
    if (userRecord.count >= this.maxRequests) {
      const secondsLeft = Math.ceil((userRecord.resetTime - now) / 1000);
      
      logger.warn('User rate limited', {
        userId,
        count: userRecord.count,
        maxRequests: this.maxRequests,
        secondsLeft
      });

      return {
        limited: true,
        secondsLeft,
        maxRequests: this.maxRequests,
        resetTime: userRecord.resetTime
      };
    }

    // Increment request counter
    userRecord.count++;
    
    logger.debug('Request counted for user', {
      userId,
      count: userRecord.count,
      maxRequests: this.maxRequests
    });

    return false;
  }

  /**
   * Manually reset a user's rate limit
   * @param {string|number} userId - User to reset
   */
  reset(userId) {
    this.requests.delete(userId);
    logger.debug('Rate limit reset for user', { userId });
  }

  /**
   * Get current stats for a user
   * @param {string|number} userId - User to check
   * @returns {Object} Current stats
   */
  getStats(userId) {
    const userRecord = this.requests.get(userId);
    if (!userRecord) {
      return { count: 0, maxRequests: this.maxRequests, windowSeconds: this.windowMs / 1000 };
    }

    const now = Date.now();
    const secondsUntilReset = Math.ceil((userRecord.resetTime - now) / 1000);
    
    return {
      count: userRecord.count,
      maxRequests: this.maxRequests,
      remaining: Math.max(0, this.maxRequests - userRecord.count),
      secondsUntilReset: Math.max(0, secondsUntilReset),
      resetTime: userRecord.resetTime
    };
  }

  /**
   * Clear all rate limit records (useful for testing)
   */
  clear() {
    this.requests.clear();
    logger.debug('All rate limit records cleared');
  }

  /**
   * Get memory usage info
   * @returns {Object} Stats about limiter
   */
  getMemoryStats() {
    const now = Date.now();
    let activeUsers = 0;
    let expiredRecords = 0;

    for (const [userId, record] of this.requests.entries()) {
      if (now > record.resetTime) {
        expiredRecords++;
      } else {
        activeUsers++;
      }
    }

    return {
      totalRecords: this.requests.size,
      activeUsers,
      expiredRecords
    };
  }
}

module.exports = RateLimiter;
