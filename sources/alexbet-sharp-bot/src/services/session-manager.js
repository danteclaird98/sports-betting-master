/**
 * Session Manager Service
 * Manages user session state, preferences, and temporary data
 * 
 * Handles:
 * - User session lifecycle (create, update, destroy)
 * - Session expiration and cleanup
 * - Temporary state (scan results, pending operations)
 * - User preferences persistence (bankroll, timezone)
 * 
 * Usage:
 * const sessionMgr = new SessionManager();
 * const session = sessionMgr.getSession(userId);
 * session.setState('bankroll', 1000);
 * const bankroll = session.getState('bankroll');
 */

const logger = require('../utils/logger');

class Session {
  constructor(userId, expiresIn = 3600000) { // 1 hour default
    this.userId = userId;
    this.createdAt = Date.now();
    this.expiresAt = Date.now() + expiresIn;
    this.lastActivityAt = Date.now();
    this.state = new Map(); // Temporary state
    this.preferences = new Map(); // Persistent preferences
    this.metadata = {
      commandCount: 0,
      lastCommand: null,
      isActive: true
    };

    logger.debug('Session created', { userId, expiresIn });
  }

  /**
   * Check if session is expired
   */
  isExpired() {
    return Date.now() > this.expiresAt;
  }

  /**
   * Update session activity timestamp
   */
  touch() {
    this.lastActivityAt = Date.now();
  }

  /**
   * Get session age in milliseconds
   */
  getAge() {
    return Date.now() - this.createdAt;
  }

  /**
   * Get remaining time in milliseconds
   */
  getTimeRemaining() {
    return Math.max(0, this.expiresAt - Date.now());
  }

  /**
   * Set temporary state
   */
  setState(key, value) {
    this.state.set(key, {
      value,
      setAt: Date.now()
    });
  }

  /**
   * Get temporary state
   */
  getState(key) {
    const data = this.state.get(key);
    return data ? data.value : null;
  }

  /**
   * Check if state exists
   */
  hasState(key) {
    return this.state.has(key);
  }

  /**
   * Delete state
   */
  deleteState(key) {
    this.state.delete(key);
  }

  /**
   * Clear all temporary state
   */
  clearState() {
    this.state.clear();
  }

  /**
   * Set persistent preference
   */
  setPreference(key, value) {
    this.preferences.set(key, {
      value,
      updatedAt: Date.now()
    });
  }

  /**
   * Get persistent preference
   */
  getPreference(key, defaultValue = null) {
    const data = this.preferences.get(key);
    return data ? data.value : defaultValue;
  }

  /**
   * Get all preferences
   */
  getAllPreferences() {
    const prefs = {};
    for (const [key, data] of this.preferences.entries()) {
      prefs[key] = data.value;
    }
    return prefs;
  }

  /**
   * Record command execution
   */
  recordCommand(commandName) {
    this.metadata.commandCount++;
    this.metadata.lastCommand = {
      name: commandName,
      executedAt: Date.now()
    };
    this.touch();
  }

  /**
   * Get session summary
   */
  getSummary() {
    return {
      userId: this.userId,
      age: this.getAge(),
      timeRemaining: this.getTimeRemaining(),
      isExpired: this.isExpired(),
      isActive: this.metadata.isActive,
      commandCount: this.metadata.commandCount,
      lastCommand: this.metadata.lastCommand,
      stateSize: this.state.size,
      preferencesSize: this.preferences.size
    };
  }

  /**
   * Destroy session
   */
  destroy() {
    this.metadata.isActive = false;
    this.state.clear();
    logger.debug('Session destroyed', { userId: this.userId });
  }
}

class SessionManager {
  constructor(options = {}) {
    this.sessions = new Map(); // userId -> Session
    this.expiresIn = options.expiresIn || 3600000; // 1 hour default
    this.cleanupInterval = options.cleanupInterval || 300000; // 5 minutes
    this.maxSessions = options.maxSessions || 10000;

    logger.info('SessionManager initialized', {
      expiresInMs: this.expiresIn,
      cleanupIntervalMs: this.cleanupInterval,
      maxSessions: this.maxSessions
    });

    // Start periodic cleanup
    this.startCleanup();
  }

  /**
   * Get or create session for user
   */
  getSession(userId) {
    let session = this.sessions.get(userId);

    if (!session) {
      // Check if we've hit max sessions
      if (this.sessions.size >= this.maxSessions) {
        logger.warn('SessionManager at capacity', {
          currentSessions: this.sessions.size,
          maxSessions: this.maxSessions
        });
      }

      session = new Session(userId, this.expiresIn);
      this.sessions.set(userId, session);
    } else if (session.isExpired()) {
      // Recreate expired session
      logger.debug('Session expired, creating new', { userId });
      session.destroy();
      session = new Session(userId, this.expiresIn);
      this.sessions.set(userId, session);
    } else {
      // Touch existing session
      session.touch();
    }

    return session;
  }

  /**
   * Get existing session without creating one
   */
  getExistingSession(userId) {
    return this.sessions.get(userId);
  }

  /**
   * Delete user session
   */
  deleteSession(userId) {
    const session = this.sessions.get(userId);
    if (session) {
      session.destroy();
      this.sessions.delete(userId);
      logger.debug('Session deleted', { userId });
    }
  }

  /**
   * Check if user has active session
   */
  hasSession(userId) {
    const session = this.sessions.get(userId);
    return session && !session.isExpired();
  }

  /**
   * Get all active sessions (for admin)
   */
  getActiveSessions() {
    const active = [];
    for (const [userId, session] of this.sessions.entries()) {
      if (!session.isExpired()) {
        active.push({
          userId,
          summary: session.getSummary()
        });
      }
    }
    return active;
  }

  /**
   * Clean up expired sessions
   */
  cleanup() {
    let deletedCount = 0;
    const now = Date.now();

    for (const [userId, session] of this.sessions.entries()) {
      if (session.isExpired()) {
        session.destroy();
        this.sessions.delete(userId);
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      logger.debug('Session cleanup completed', {
        deletedCount,
        remainingSessions: this.sessions.size
      });
    }
  }

  /**
   * Start automatic cleanup interval
   */
  startCleanup() {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.cleanupInterval);
  }

  /**
   * Stop automatic cleanup
   */
  stopCleanup() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      logger.debug('Session cleanup stopped');
    }
  }

  /**
   * Get manager stats
   */
  getStats() {
    let totalActive = 0;
    let totalExpired = 0;
    let totalStateKeys = 0;

    for (const session of this.sessions.values()) {
      if (session.isExpired()) {
        totalExpired++;
      } else {
        totalActive++;
      }
      totalStateKeys += session.state.size;
    }

    return {
      totalSessions: this.sessions.size,
      activeSessions: totalActive,
      expiredSessions: totalExpired,
      totalStateKeys,
      utilization: `${Math.round((totalActive / this.maxSessions) * 100)}%`
    };
  }

  /**
   * Reset all sessions (for testing)
   */
  reset() {
    this.sessions.forEach(session => session.destroy());
    this.sessions.clear();
    logger.debug('All sessions cleared');
  }
}

module.exports = { SessionManager, Session };
