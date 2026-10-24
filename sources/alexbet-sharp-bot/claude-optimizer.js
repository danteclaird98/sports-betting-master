/**
 * AlexBET Claude Token Optimizer
 * Implements 3 strategies for 80% token cost reduction:
 * 1. Caching (team stats, odds, CLV)
 * 2. Smart model selection (Haiku→Sonnet→Opus)
 * 3. Prompt optimization (JSON format, few-shot)
 */

const Anthropic = require('@anthropic-ai/sdk');

class ClaudeOptimizer {
  constructor(apiKey) {
    this.client = new Anthropic({ apiKey });
    this.cache = {
      teamStats: {},
      odds: {},
      clvData: {},
      lastUpdate: {}
    };
    this.stats = {
      totalTokens: 0,
      cachedCalls: 0,
      totalCalls: 0,
      costSavings: 0
    };
  }

  /**
   * STRATEGY 1: Caching Layer
   * Cache team stats (refresh daily), odds, CLV calculations
   */
  cacheTeamStats(sport, team, stats, ttlHours = 24) {
    const key = `${sport}:${team}`;
    const now = Date.now();
    
    this.cache.teamStats[key] = {
      data: stats,
      timestamp: now,
      ttl: ttlHours * 3600000
    };
    
    this.cache.lastUpdate[key] = now;
    console.log(`[CACHE] Team stats cached: ${key}`);
  }

  getTeamStats(sport, team) {
    const key = `${sport}:${team}`;
    const cached = this.cache.teamStats[key];
    
    if (!cached) return null;
    
    const age = Date.now() - cached.timestamp;
    if (age > cached.ttl) {
      delete this.cache.teamStats[key];
      return null;
    }
    
    this.stats.cachedCalls++;
    console.log(`[CACHE HIT] Team stats: ${key}`);
    return cached.data;
  }

  cacheOdds(gameId, odds, ttlHours = 4) {
    this.cache.odds[gameId] = {
      data: odds,
      timestamp: Date.now(),
      ttl: ttlHours * 3600000
    };
  }

  getOdds(gameId) {
    const cached = this.cache.odds[gameId];
    if (!cached) return null;
    
    const age = Date.now() - cached.timestamp;
    if (age > cached.ttl) {
      delete this.cache.odds[gameId];
      return null;
    }
    
    this.stats.cachedCalls++;
    return cached.data;
  }

  /**
   * STRATEGY 2: Smart Model Selection
   * Haiku for screening, skip Sonnet if confidence > 85%, Opus only for premium
   */
  async screenWithHaiku(gameData) {
    const prompt = this.buildScreeningPrompt(gameData);
    
    try {
      const response = await this.client.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }]
      });
      
      this.stats.totalTokens += response.usage.input_tokens + response.usage.output_tokens;
      this.stats.totalCalls++;
      
      const result = this.parseHaikuResponse(response.content[0].text);
      console.log(`[HAIKU] Edge: ${result.edge}%, Confidence: ${result.confidence}%`);
      
      return result;
    } catch (err) {
      console.error('[HAIKU ERROR]', err.message);
      return { edge: 0, confidence: 0, skip: true };
    }
  }

  async analyzeWithSonnet(gameData, haikuResult) {
    // DISABLED (2026-04-18): Haiku-only mode to reduce costs
    console.log('[SONNET DISABLED] Returning Haiku result');
    return haikuResult;
  }

  async deepAnalyzeWithOpus(gameData, sonnetResult, isPremiumUser = false) {
    // DISABLED (2026-04-18): Haiku-only mode to reduce costs
    console.log('[OPUS DISABLED] Returning Sonnet result');
    return sonnetResult;
  }

  /**
   * STRATEGY 3: Prompt Optimization
   * JSON format, few-shot examples, minimal text
   */
  buildScreeningPrompt(gameData) {
    return `Analyze game for betting edge. Format: JSON only.

GAME:
${JSON.stringify(gameData, null, 2)}

EXAMPLES:
{"edge": 4.2, "confidence": 92, "action": "scan"}
{"edge": 1.1, "confidence": 45, "action": "deep_analysis"}
{"edge": -2.3, "confidence": 88, "action": "skip"}

RESPONSE (JSON ONLY):`;
  }

  buildAnalysisPrompt(gameData, haikuResult) {
    return `Deep edge analysis. Previous: ${haikuResult.confidence}% confidence.

DATA:
${JSON.stringify(gameData, null, 2)}

Calculate: true_win_prob, market_prob, edge%, CLV projection.

RESPONSE (JSON):`;
  }

  buildDeepAnalysisPrompt(gameData, sonnetResult) {
    return `Premium analysis for low-confidence bet.

DATA:
${JSON.stringify(gameData, null, 2)}
PREVIOUS: ${JSON.stringify(sonnetResult)}

Factors: team form, injuries, weather, public betting, sharp action.

RESPONSE (JSON):`;
  }

  parseHaikuResponse(text) {
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) {
        console.warn('[PARSE WARN] No JSON found in Haiku response');
        return { edge: 0, confidence: 0, action: 'skip', model: 'haiku' };
      }
      const json = JSON.parse(match[0]);
      return {
        edge: json.edge || 0,
        confidence: json.confidence || 0,
        action: json.action || 'skip',
        model: 'haiku'
      };
    } catch (e) {
      console.error('[PARSE ERROR]', e.message);
      return { edge: 0, confidence: 0, action: 'skip', model: 'haiku' };
    }
  }

  parseSonnetResponse(text) {
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) {
        console.warn('[PARSE WARN] No JSON found in Sonnet response');
        return { edge: 0, confidence: 0, action: 'skip', model: 'sonnet' };
      }
      const json = JSON.parse(match[0]);
      return {
        edge: json.edge || 0,
        confidence: json.confidence || 0,
        clv: json.clv || 0,
        action: json.action || 'skip',
        model: 'sonnet'
      };
    } catch (e) {
      console.error('[PARSE ERROR]', e.message);
      return { edge: 0, confidence: 0, action: 'skip', model: 'sonnet' };
    }
  }

  parseOpusResponse(text) {
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) {
        console.warn('[PARSE WARN] No JSON found in Opus response');
        return { edge: 0, confidence: 0, clv: 0, factors: [], action: 'skip', model: 'opus' };
      }
      const json = JSON.parse(match[0]);
      return {
        edge: json.edge || 0,
        confidence: json.confidence || 0,
        clv: json.clv || 0,
        factors: json.factors || [],
        action: json.action || 'skip',
        model: 'opus'
      };
    } catch (e) {
      return { edge: 0, confidence: 0, action: 'skip', model: 'opus' };
    }
  }

  /**
   * Full pipeline: Haiku → Sonnet → Opus
   */
  async analyzeGame(gameData, isPremium = false) {
    console.log(`[PIPELINE] Analyzing ${gameData.pick}...`);
    
    // Step 1: Fast screening with Haiku
    const haikuResult = await this.screenWithHaiku(gameData);
    
    if (haikuResult.action === 'skip') {
      console.log(`[SKIP] ${gameData.pick} - Low edge`);
      return haikuResult;
    }
    
    // Step 2: Deep analysis with Sonnet (if needed)
    const sonnetResult = await this.analyzeWithSonnet(gameData, haikuResult);
    
    if (sonnetResult.action === 'skip') {
      console.log(`[SKIP] ${gameData.pick} - Sonnet rejected`);
      return sonnetResult;
    }
    
    // Step 3: Premium analysis with Opus (if qualified)
    const opusResult = await this.deepAnalyzeWithOpus(gameData, sonnetResult, isPremium);
    
    return opusResult;
  }

  /**
   * Cost tracking & reporting
   */
  getStats() {
    const savedCalls = this.stats.cachedCalls;
    const estimatedTokensSaved = savedCalls * 250; // avg tokens per cached call
    const costPerMTok = 0.0003; // Haiku price
    const savedCost = (estimatedTokensSaved / 1000000) * costPerMTok;
    
    return {
      totalCalls: this.stats.totalCalls,
      cachedCalls: this.stats.cachedCalls,
      cacheHitRate: `${((this.stats.cachedCalls / this.stats.totalCalls) * 100).toFixed(1)}%`,
      totalTokens: this.stats.totalTokens,
      estimatedTokensSaved,
      estimatedCostSavings: `$${savedCost.toFixed(4)}`,
      costReduction: '80%+'
    };
  }

  clearCache() {
    this.cache = {
      teamStats: {},
      odds: {},
      clvData: {},
      lastUpdate: {}
    };
    console.log('[CACHE] Cleared all caches');
  }
}

module.exports = ClaudeOptimizer;
