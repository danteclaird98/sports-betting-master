/**
 * Gem calculation and fetching
 * Core logic for finding +EV opportunities via Odds API
 */

const https = require('https');
const { americanToImpliedProb, americanToDecimal } = require('./odds-conversion');
const { formatGameDateTime, getOutcomeKey, formatSignalLabel } = require('./formatting');

const ODDS_API_KEY = process.env.ODDS_API_KEY;

// Sport league names and emojis
const sportInfo = {
  'basketball_nba': { league: 'NBA', emoji: '🏀', name: 'Basketball' },
  'americanfootball_nfl': { league: 'NFL', emoji: '🏈', name: 'American Football' },
  'baseball_mlb': { league: 'MLB', emoji: '⚾', name: 'Baseball' },
  'icehockey_nhl': { league: 'NHL', emoji: '🏒', name: 'Hockey' },
  'tennis_atp': { league: 'ATP', emoji: '🎾', name: 'Tennis' },
  'soccer_epl': { league: 'EPL', emoji: '⚽', name: 'Soccer' }
};

function calculateKellyStake(bankroll, fairProb, americanOdds) {
  const decimalOdds = americanToDecimal(americanOdds);
  const b = decimalOdds - 1;
  const q = 1 - fairProb;
  const rawKelly = ((b * fairProb) - q) / b;
  const cappedKelly = Math.max(0, Math.min(rawKelly, 0.05));
  return Math.floor(bankroll * cappedKelly * 0.5);
}

// Fetch REAL gems using native https
async function fetchRealGems(bankroll = 100, timezone = 'America/New_York') {
  return new Promise((resolve) => {
    try {
      const sports = ['basketball_nba', 'americanfootball_nfl', 'baseball_mlb', 'icehockey_nhl', 'tennis_atp', 'soccer_epl'];
      const markets = ['h2h', 'spreads', 'totals'];
      let allGems = [];
      let completed = 0;
      const totalRequests = sports.length * markets.length;

      sports.forEach(sport => {
        markets.forEach(market => {
          const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=${market}&oddsFormat=american`;

          const req = https.get(url, (res) => {
            let data = '';
            let isTimedOut = false;
            
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
              if (isTimedOut) return; // Skip if already timed out
              try {
                if (!data || data.length === 0) {
                  console.warn(`[ODDS API] Empty response for ${sport} ${market}`);
                  completed++;
                  if (completed === totalRequests) {
                    resolve(allGems.length > 0 ? allGems : null);
                  }
                  return;
                }
                let games;
                try {
                  games = JSON.parse(data) || [];
                } catch (parseErr) {
                  console.error(`[ODDS API JSON Parse Error] ${sport} ${market}`, parseErr.message);
                  console.error(`Response length: ${data.length}, First 200 chars:`, data.substring(0, 200));
                  console.error(`Last 100 chars:`, data.substring(Math.max(0, data.length - 100)));
                  completed++;
                  if (completed === totalRequests) {
                    resolve(allGems.length > 0 ? allGems : null);
                  }
                  return;
                }
                games = games || [];
                
                games.forEach(game => {
                  const bookmakers = game.bookmakers || [];
                  if (bookmakers.length === 0) return;

                  const marketName = market === 'h2h' ? 'ML' : market === 'spreads' ? 'Spread' : 'Total';
                  const sInfo = sportInfo[sport] || { league: 'UNKNOWN', emoji: '🏅' };
                  const { gameDate, gameTime } = formatGameDateTime(game.commence_time, timezone);
                  const outcomeMap = new Map();

                  // ✅ FIX: Collect raw implied probabilities (no normalization by vig)
                  let processedBooks = 0;
                  bookmakers.forEach(bookmaker => {
                    const bookMarket = (bookmaker.markets || []).find(m => m.key === market);
                    const outcomes = bookMarket?.outcomes || [];
                    if (outcomes.length < 2) {
                      // This bookmaker doesn't have this market
                      return;
                    }
                    
                    processedBooks++;

                    outcomes.forEach(outcome => {
                      const impliedProb = americanToImpliedProb(outcome.price);
                      if (impliedProb == null) return;

                      const key = getOutcomeKey(outcome, market);
                      const existing = outcomeMap.get(key) || {
                        outcome,
                        impliedProbs: [],
                        bookmakers: new Set(),  // ✅ Track UNIQUE bookmakers
                        bestPrice: null,
                        bestBook: null
                      };

                      existing.impliedProbs.push(impliedProb);
                      existing.bookmakers.add(bookmaker.title);  // ✅ Add bookmaker name

                      if (existing.bestPrice == null || Number(outcome.price) > existing.bestPrice) {
                        existing.bestPrice = Number(outcome.price);
                        existing.bestBook = bookmaker.title;
                      }

                      outcomeMap.set(key, existing);
                    });
                  });

                  // DEBUG: Log outcome map size
                  if (outcomeMap.size > 0 && processedBooks > 0) {
                    console.log(`[GEM DEBUG] ${game.away_team} vs ${game.home_team} (${market}): Found ${outcomeMap.size} outcomes from ${processedBooks}/${bookmakers.length} books`);
                    outcomeMap.forEach((data, key) => {
                      console.log(`  Outcome: ${key}, Books: ${data.books}, BestPrice: ${data.bestPrice}, Probs: ${data.impliedProbs.length}`);
                    });
                  }

                  // ✅ FIX: Calculate edge using market consensus (no vig normalization)
                  let filteredCount = 0;
                  outcomeMap.forEach(({ outcome, impliedProbs, bestPrice, bestBook, bookmakers }) => {
                    const books = bookmakers.size;  // ✅ Count of UNIQUE bookmakers
                    if (!impliedProbs.length || bestPrice == null || books < 2) {
                      // DEBUG
                      if (allGems.length === 0 && processedBooks > 0) {
                        console.log(`[GEM SKIP] ${outcome.name}: Probs=${impliedProbs.length} Price=${bestPrice} Books=${books}`);
                      }
                      return;
                    }
                    
                    filteredCount++;

                    // Market consensus = average of raw implied probs across all bookmakers
                    const consensusProb = impliedProbs.reduce((sum, value) => sum + value, 0) / impliedProbs.length;
                    
                    // Best odds imply this probability
                    const bestOddsImpliedProb = americanToImpliedProb(bestPrice);
                    
                    // Edge: positive when consensus > best odds (value opportunity)
                    const edge = (consensusProb - bestOddsImpliedProb) * 100;
                    
                    const decimalOdds = americanToDecimal(bestPrice);
                    const ev = (consensusProb * decimalOdds) - 1;

                    // DEBUG LOGGING
                    const isValid = Number.isFinite(ev) && Number.isFinite(edge) && ev > 0.0001;
                    if (allGems.length < 5) {
                      // Log first 5 outcomes for debugging
                      console.log(`[GEM CALC] ${game.away_team} vs ${game.home_team} | ${outcome.name}: EV=${ev.toFixed(6)} Edge=${edge.toFixed(3)}% Books=${books} Valid=${isValid}`);
                    }

                    // Quality threshold: 2% EV minimum (eliminate noise, focus on real opportunities)
                    if (!Number.isFinite(ev) || !Number.isFinite(edge) || ev <= 0.02) return;

                    const kelly = calculateKellyStake(bankroll, consensusProb, bestPrice);  // ✅ Changed: use consensusProb
                    const conservative1pct = Math.floor(bankroll * 0.01);
                    const conservative1_5pct = Math.floor(bankroll * 0.015);
                    const conservative2pct = Math.floor(bankroll * 0.02);

                    const betTypeMap = { 'ML': 'MONEYLINE', 'Spread': 'SPREAD', 'Total': 'TOTAL' };
                    allGems.push({
                      id: `${game.id}_${market}_${getOutcomeKey(outcome, market)}`,
                      signal: formatSignalLabel(outcome, market),
                      odds: bestPrice,
                      edge: Number(edge.toFixed(2)),
                      ev: Number((ev * 100).toFixed(2)),
                      game: `${game.away_team} vs ${game.home_team}`,
                      gameDate,
                      gameTime,
                      market: marketName,
                      betType: betTypeMap[marketName] || 'UNKNOWN',
                      sport: sport.split('_')[1].toUpperCase(),
                      league: sInfo.league,
                      sportEmoji: sInfo.emoji,
                      book: bestBook,
                      booksCompared: books,
                      kelly,
                      conservative: {
                        one: conservative1pct,
                        oneHalf: conservative1_5pct,
                        two: conservative2pct
                      }
                    });
                  });
                });
              } catch (err) {
                console.error(`[ODDS API Parse Error] ${sport} ${market}:`, err.message);
                console.error(`[DEBUG] Response length: ${data.length}, First 500 chars:`, data.substring(0, 500));
              }

              completed++;
              if (completed === totalRequests) {
                resolve(allGems.length > 0 ? allGems : null);
              }
            });
          });

          // Set timeout: 5 seconds max per request
          req.setTimeout(5000);
          req.on('timeout', () => {
            isTimedOut = true;
            req.destroy();
            console.warn(`[TIMEOUT] Request timed out for ${sport} ${market}`);
            completed++;
            if (completed === totalRequests) {
              resolve(allGems.length > 0 ? allGems : null);
            }
          });

          req.on('error', (err) => {
            if (isTimedOut) return; // Don't handle if already timed out
            console.error(`Error fetching ${sport} ${market}:`, err.message);
            completed++;
            if (completed === totalRequests) {
              resolve(allGems.length > 0 ? allGems : null);
            }
          });
        });
      });
    } catch (err) {
      console.error('fetchRealGems error:', err.message);
      resolve(null);
    }
  });
}

module.exports = {
  fetchRealGems,
  calculateKellyStake,
  sportInfo
};
