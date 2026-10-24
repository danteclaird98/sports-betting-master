/**
 * Retry logic utilities
 * Handles exponential backoff for failed requests
 */

const logger = require('./logger');

/**
 * Retry with exponential backoff
 * Implements: delay = initialDelay * 2^(attemptNumber-1)
 * Attempt 1: 1s, Attempt 2: 2s, Attempt 3: 4s
 */
async function retryWithBackoff(fn, maxAttempts = 3, initialDelay = 1000) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      logger.debug('Attempting operation', { attempt, maxAttempts });
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt < maxAttempts) {
        // Calculate exponential backoff: 1s, 2s, 4s, etc.
        const delayMs = initialDelay * Math.pow(2, attempt - 1);
        logger.warn('Request failed, retrying with backoff', {
          attempt,
          maxAttempts,
          nextRetryInMs: delayMs,
          nextRetryInSec: (delayMs / 1000).toFixed(1),
          error: error.message
        });
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  
  // All attempts failed
  throw new Error(`Failed after ${maxAttempts} attempts: ${lastError.message}`);
}

module.exports = {
  retryWithBackoff
};
