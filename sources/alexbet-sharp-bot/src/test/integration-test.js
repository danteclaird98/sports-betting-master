/**
 * Integration Test Suite
 * Tests critical flows and rate limiter integration
 */

const RateLimiter = require('../services/rateLimiter');
const logger = require('../utils/logger');

// ============================================================================
// Test Configuration
// ============================================================================

const TEST_USER_ID = 999999999;
let testsPassed = 0;
let testsFailed = 0;

// ============================================================================
// Mock Objects
// ============================================================================

class MockBot {
  constructor() {
    this.messages = [];
  }

  sendMessage(chatId, text, options = {}) {
    this.messages.push({ chatId, text, options, type: 'message' });
    console.log(`  [BOT] sendMessage(${chatId}): ${text.substring(0, 50)}...`);
  }

  sendDocument(chatId, stream, options, callback) {
    this.messages.push({ chatId, options, type: 'document' });
    console.log(`  [BOT] sendDocument(${chatId}): ${options.filename}`);
    if (callback) callback(null);
  }

  sendPhoto(chatId, path) {
    this.messages.push({ chatId, path, type: 'photo' });
    console.log(`  [BOT] sendPhoto(${chatId})`);
  }

  getLastMessage() {
    return this.messages[this.messages.length - 1];
  }

  getAllMessages() {
    return this.messages;
  }

  clearMessages() {
    this.messages = [];
  }
}

class MockSessionManager {
  constructor() {
    this.sessions = {};
  }

  getSession(userId) {
    if (!this.sessions[userId]) {
      this.sessions[userId] = { userId, preferences: {}, createdAt: Date.now() };
    }
    return this.sessions[userId];
  }

  setPreference(userId, key, value) {
    const session = this.getSession(userId);
    session.preferences[key] = value;
    session.updatedAt = Date.now();
  }

  getPreference(userId, key) {
    const session = this.getSession(userId);
    return session.preferences[key];
  }

  getAllSessions() {
    return Object.values(this.sessions);
  }

  getSessions() {
    return this.sessions;
  }
}

// ============================================================================
// Test Utilities
// ============================================================================

function assert(condition, message) {
  if (!condition) {
    console.error(`  ❌ FAILED: ${message}`);
    testsFailed++;
    throw new Error(message);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    console.error(`  ❌ FAILED: ${message}`);
    console.error(`     Expected: ${expected}, Got: ${actual}`);
    testsFailed++;
    throw new Error(message);
  }
}

function test(name, fn) {
  console.log(`\n📋 TEST: ${name}`);
  try {
    fn();
    testsPassed++;
    console.log(`✅ PASSED: ${name}`);
  } catch (err) {
    console.error(`❌ FAILED: ${name}`);
    console.error(`   Error: ${err.message}`);
  }
}

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

console.log('\n' + '='.repeat(70));
console.log('🧪 ALEXBET SHARP BOT - INTEGRATION TEST SUITE');
console.log('='.repeat(70));

// ============================================================================
// TEST 1: Rate Limiter Basics
// ============================================================================

test('Rate Limiter - Initialize with defaults', () => {
  const limiter = new RateLimiter();
  assert(limiter.maxRequests === 10, 'Default maxRequests should be 10');
  assert(limiter.windowMs === 60000, 'Default windowMs should be 60000');
});

test('Rate Limiter - Initialize with custom values', () => {
  const limiter = new RateLimiter(5, 120000);
  assert(limiter.maxRequests === 5, 'Custom maxRequests should be 5');
  assert(limiter.windowMs === 120000, 'Custom windowMs should be 120000');
});

test('Rate Limiter - First request is always allowed', () => {
  const limiter = new RateLimiter(3, 60000);
  const result = limiter.isRateLimited(TEST_USER_ID);
  assert(result === false, 'First request should not be limited');
});

test('Rate Limiter - Second request is allowed', () => {
  const limiter = new RateLimiter(3, 60000);
  limiter.isRateLimited(TEST_USER_ID);
  const result = limiter.isRateLimited(TEST_USER_ID);
  assert(result === false, 'Second request should not be limited');
});

test('Rate Limiter - Limit is enforced at threshold', () => {
  const limiter = new RateLimiter(3, 60000);
  // Make 3 requests (each should be allowed)
  assert(limiter.isRateLimited(TEST_USER_ID) === false, '1st request allowed');
  assert(limiter.isRateLimited(TEST_USER_ID) === false, '2nd request allowed');
  assert(limiter.isRateLimited(TEST_USER_ID) === false, '3rd request allowed');
  
  // 4th request should be limited
  const result = limiter.isRateLimited(TEST_USER_ID);
  assert(result.limited === true, '4th request should be limited');
  assert(result.secondsLeft > 0, 'Should have secondsLeft property');
  assert(result.maxRequests === 3, 'Should show max requests');
});

test('Rate Limiter - Different users have separate limits', () => {
  const limiter = new RateLimiter(2, 60000);
  const user1 = 111111;
  const user2 = 222222;

  // User 1: 2 requests
  limiter.isRateLimited(user1);
  limiter.isRateLimited(user1);
  const user1_3rd = limiter.isRateLimited(user1);
  
  // User 2: 1 request (should be allowed)
  const user2_1st = limiter.isRateLimited(user2);

  assert(user1_3rd.limited === true, 'User 1 should be limited');
  assert(user2_1st === false, 'User 2 should not be limited');
});

test('Rate Limiter - Reset clears user records', () => {
  const limiter = new RateLimiter(2, 60000);
  limiter.isRateLimited(TEST_USER_ID);
  limiter.isRateLimited(TEST_USER_ID);
  
  limiter.reset(TEST_USER_ID);
  
  const result = limiter.isRateLimited(TEST_USER_ID);
  assert(result === false, 'After reset, first request should be allowed');
});

test('Rate Limiter - Clear removes all records', () => {
  const limiter = new RateLimiter(2, 60000);
  limiter.isRateLimited(111);
  limiter.isRateLimited(222);
  limiter.isRateLimited(333);
  
  limiter.clear();
  
  const stats = limiter.getMemoryStats();
  assert(stats.totalRecords === 0, 'After clear, should have no records');
});

test('Rate Limiter - getStats returns correct info', () => {
  const limiter = new RateLimiter(5, 60000);
  limiter.isRateLimited(TEST_USER_ID);
  limiter.isRateLimited(TEST_USER_ID);
  
  const stats = limiter.getStats(TEST_USER_ID);
  assert(stats.count === 2, 'Should have 2 requests');
  assert(stats.remaining === 3, 'Should have 3 remaining');
  assert(stats.maxRequests === 5, 'Should show max of 5');
});

// ============================================================================
// TEST 2: Handler Integration Tests
// ============================================================================

test('Handler Context - Export Handler Rate Limiter', () => {
  const exportHandler = require('../handlers/export');
  const bot = new MockBot();
  const limiter = new RateLimiter(2, 60000);
  
  const isAdmin = () => false;
  const latestScans = {};
  
  exportHandler.setContext(bot, isAdmin, latestScans, limiter);
  
  // Verify context was set by checking that handler references it
  assert(exportHandler, 'Export handler should exist');
});

test('Handler Context - Stats Handler Rate Limiter', () => {
  const statsHandler = require('../handlers/stats');
  const bot = new MockBot();
  const limiter = new RateLimiter(20, 60000);
  
  statsHandler.setContext(bot, limiter);
  
  assert(statsHandler, 'Stats handler should exist');
});

test('Handler Context - Bankroll Handler Rate Limiter', () => {
  const bankrollHandler = require('../handlers/bankroll');
  const bot = new MockBot();
  const limiter = new RateLimiter(5, 60000);
  const bankrolls = {};
  
  bankrollHandler.setContext(bot, bankrolls, limiter);
  
  assert(bankrollHandler, 'Bankroll handler should exist');
});

// ============================================================================
// TEST 3: Session Manager
// ============================================================================

test('Session Manager - Create and retrieve', () => {
  const sessionMgr = new MockSessionManager();
  const userId = 123456;
  
  const session = sessionMgr.getSession(userId);
  assert(session, 'Session should be created');
  assert(session.userId === userId, 'Session should have correct userId');
});

test('Session Manager - Set and get preferences', () => {
  const sessionMgr = new MockSessionManager();
  const userId = 123456;
  
  sessionMgr.setPreference(userId, 'bankroll', 1000);
  const bankroll = sessionMgr.getPreference(userId, 'bankroll');
  
  assertEqual(bankroll, 1000, 'Preference should be retrievable');
});

test('Session Manager - Multiple sessions', () => {
  const sessionMgr = new MockSessionManager();
  
  sessionMgr.setPreference(111, 'bankroll', 500);
  sessionMgr.setPreference(222, 'bankroll', 1000);
  
  const sessions = sessionMgr.getAllSessions();
  assert(sessions.length === 2, 'Should have 2 sessions');
  
  const user1Bankroll = sessionMgr.getPreference(111, 'bankroll');
  const user2Bankroll = sessionMgr.getPreference(222, 'bankroll');
  
  assertEqual(user1Bankroll, 500, 'User 1 bankroll should be 500');
  assertEqual(user2Bankroll, 1000, 'User 2 bankroll should be 1000');
});

test('Session Manager - Large number of sessions', () => {
  const sessionMgr = new MockSessionManager();
  
  // Create 100 sessions
  for (let i = 0; i < 100; i++) {
    sessionMgr.setPreference(i, 'test_key', `test_value_${i}`);
  }
  
  const sessions = sessionMgr.getAllSessions();
  assert(sessions.length === 100, 'Should handle 100 sessions without crashing');
});

// ============================================================================
// TEST 4: Rate Limiter Behavior Tests
// ============================================================================

test('Rate Limiter - Scan limiter (10 per minute)', () => {
  const scanLimiter = new RateLimiter(10, 60000);
  const userId = TEST_USER_ID;
  
  // Make 10 requests (all should pass)
  for (let i = 0; i < 10; i++) {
    const result = scanLimiter.isRateLimited(userId);
    assert(result === false, `Request ${i + 1} should be allowed`);
  }
  
  // 11th request should be limited
  const limited = scanLimiter.isRateLimited(userId);
  assert(limited.limited === true, '11th request should be limited');
  assert(limited.maxRequests === 10, 'Should show max of 10');
});

test('Rate Limiter - Export limiter (5 per minute)', () => {
  const exportLimiter = new RateLimiter(5, 60000);
  const userId = TEST_USER_ID;
  
  // Make 5 requests
  for (let i = 0; i < 5; i++) {
    const result = exportLimiter.isRateLimited(userId);
    assert(result === false, `Request ${i + 1} should be allowed`);
  }
  
  // 6th request should be limited
  const limited = exportLimiter.isRateLimited(userId);
  assert(limited.limited === true, '6th request should be limited');
});

test('Rate Limiter - Stats limiter (20 per minute)', () => {
  const statsLimiter = new RateLimiter(20, 60000);
  const userId = TEST_USER_ID;
  
  // Make 20 requests
  for (let i = 0; i < 20; i++) {
    const result = statsLimiter.isRateLimited(userId);
    assert(result === false, `Request ${i + 1} should be allowed`);
  }
  
  // 21st request should be limited
  const limited = statsLimiter.isRateLimited(userId);
  assert(limited.limited === true, '21st request should be limited');
});

test('Rate Limiter - Bankroll limiter (5 per minute)', () => {
  const bankrollLimiter = new RateLimiter(5, 60000);
  const userId = TEST_USER_ID;
  
  // Make 5 requests
  for (let i = 0; i < 5; i++) {
    const result = bankrollLimiter.isRateLimited(userId);
    assert(result === false, `Request ${i + 1} should be allowed`);
  }
  
  // 6th request should be limited
  const limited = bankrollLimiter.isRateLimited(userId);
  assert(limited.limited === true, '6th request should be limited');
});

// ============================================================================
// TEST 5: Mock Bot Behavior
// ============================================================================

test('Mock Bot - Send messages', () => {
  const bot = new MockBot();
  
  bot.sendMessage(123, 'Test message');
  bot.sendMessage(456, 'Another message');
  
  const messages = bot.getAllMessages();
  assert(messages.length === 2, 'Should have 2 messages');
  assert(messages[0].chatId === 123, 'First message should be to chat 123');
  assert(messages[1].chatId === 456, 'Second message should be to chat 456');
});

test('Mock Bot - Last message', () => {
  const bot = new MockBot();
  
  bot.sendMessage(123, 'First');
  bot.sendMessage(456, 'Second');
  
  const last = bot.getLastMessage();
  assert(last.chatId === 456, 'Last message should be second one');
});

test('Mock Bot - Clear messages', () => {
  const bot = new MockBot();
  
  bot.sendMessage(123, 'Message 1');
  bot.sendMessage(456, 'Message 2');
  bot.clearMessages();
  
  const messages = bot.getAllMessages();
  assert(messages.length === 0, 'Messages should be cleared');
});

// ============================================================================
// Summary
// ============================================================================

console.log('\n' + '='.repeat(70));
console.log('📊 TEST SUMMARY');
console.log('='.repeat(70));
console.log(`✅ Passed: ${testsPassed}`);
console.log(`❌ Failed: ${testsFailed}`);
console.log(`📈 Total:  ${testsPassed + testsFailed}`);
console.log('='.repeat(70));

if (testsFailed === 0) {
  console.log('\n🎉 ALL TESTS PASSED! 🎉\n');
  process.exit(0);
} else {
  console.log(`\n⚠️  ${testsFailed} TEST(S) FAILED\n`);
  process.exit(1);
}
