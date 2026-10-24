// tracker.js
// Live Odds Tracker — SportsGameOdds API
// Detects line movement across bookmakers and sends alerts
// Docs: https://sportsgameodds.com/docs/examples/live-odds-tracker

const fetch = require("node-fetch");
const fs = require("fs");
require("dotenv").config();

// ─── Configuration ────────────────────────────────────────────────────────────
// Adjust these to suit your use case

const API_KEY = process.env.SPORTSGAMEODDS_KEY;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const API_BASE = "https://api.sportsgameodds.com/v2";

const POLL_INTERVAL = 30_000;    // How often to check, in ms (30 seconds)
const LEAGUES = ["NBA"];         // Add "NFL", "NHL", "MLB" etc. to track more
const MIN_LINE_MOVE = 0.5;       // Minimum spread/total move to alert on (points)
const MIN_PRICE_MOVE = 5;        // Minimum price/juice move to alert on (American odds points)
const LOG_TO_FILE = true;        // Write movement history to movement-history.jsonl

// ─── State ────────────────────────────────────────────────────────────────────

// Stores the last seen odds for every market/bookmaker combination
let previousOdds = {};

// ─── API ──────────────────────────────────────────────────────────────────────

/**
 * Fetch current odds for a given league.
 * Uses finalized=false to get upcoming games.
 * Use live=true instead to only track in-progress games.
 */
async function fetchOdds(leagueID) {
  try {
    const response = await fetch(
      `${API_BASE}/events?leagueID=${leagueID}&finalized=false&oddsAvailable=true`,
      { headers: { "x-api-key": API_KEY } }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error(`Error fetching ${leagueID} odds:`, error.message);
    return [];
  }
}

// ─── Movement detection ───────────────────────────────────────────────────────

/**
 * Compare current odds against stored previous odds and return all changes.
 * Detects both line changes (spread/total) and price changes (juice).
 */
function detectLineMovement(events) {
  const movements = [];

  events.forEach((event) => {
    const awayName = event.teams.away.names.long;
    const homeName = event.teams.home.names.long;
    const matchup = `${awayName} @ ${homeName}`;

    Object.entries(event.odds || {}).forEach(([oddID, currentOdd]) => {
      if (!currentOdd.byBookmaker) return;

      Object.entries(currentOdd.byBookmaker).forEach(([bookmakerID, currentBookmakerOdds]) => {
        if (!currentBookmakerOdds.available) return;

        // Unique key per event + market + bookmaker
        const key = `${event.eventID}-${oddID}-${bookmakerID}`;
        const prev = previousOdds[key];

        if (prev) {
          const currentLine = currentBookmakerOdds.spread || currentBookmakerOdds.overUnder;
          const previousLine = prev.spread || prev.overUnder;
          const lineChanged = previousLine !== currentLine;
          const priceChanged = prev.odds !== currentBookmakerOdds.odds;

          if (lineChanged || priceChanged) {
            movements.push({
              matchup,
              eventID: event.eventID,
              betType: currentOdd.betTypeID,
              side: currentOdd.sideID,
              bookmaker: bookmakerID,
              previous: { line: previousLine, price: prev.odds },
              current: { line: currentLine, price: currentBookmakerOdds.odds },
              lineChanged,
              priceChanged,
              timestamp: new Date().toISOString(),
            });
          }
        }

        // Store for next comparison
        previousOdds[key] = {
          spread: currentBookmakerOdds.spread,
          overUnder: currentBookmakerOdds.overUnder,
          odds: currentBookmakerOdds.odds,
          lastUpdatedAt: currentBookmakerOdds.lastUpdatedAt,
        };
      });
    });
  });

  return movements;
}

/**
 * Filter movements to only those exceeding the configured thresholds.
 * Adjust MIN_LINE_MOVE and MIN_PRICE_MOVE at the top of the file.
 */
function filterSignificantMoves(movements) {
  return movements.filter((m) => {
    if (m.lineChanged && m.current.line && m.previous.line) {
      const diff = Math.abs(parseFloat(m.current.line) - parseFloat(m.previous.line));
      if (diff >= MIN_LINE_MOVE) return true;
    }
    if (m.priceChanged && m.current.price && m.previous.price) {
      const diff = Math.abs(parseInt(m.current.price) - parseInt(m.previous.price));
      if (diff >= MIN_PRICE_MOVE) return true;
    }
    return false;
  });
}

// ─── Output ───────────────────────────────────────────────────────────────────

/** Print movements to the console. */
function displayMovements(movements) {
  if (movements.length === 0) {
    console.log("  No significant line movement detected\n");
    return;
  }

  console.log(`\n  ${movements.length} LINE MOVEMENT(S) DETECTED\n`);

  movements.forEach((m) => {
    console.log("  ----------------------------------------");
    console.log(`  ${m.matchup}`);
    console.log(`  ${m.betType.toUpperCase()} (${m.side}) — ${m.bookmaker}`);
    if (m.lineChanged) console.log(`  Line:  ${m.previous.line} → ${m.current.line}`);
    if (m.priceChanged) console.log(`  Price: ${m.previous.price} → ${m.current.price}`);
    console.log("  ----------------------------------------\n");
  });
}

/** Append movements to a .jsonl file for historical analysis. */
function logMovementsToFile(movements) {
  if (!LOG_TO_FILE || movements.length === 0) return;

  const lines = movements.map((m) => JSON.stringify(m)).join("\n") + "\n";
  fs.appendFileSync("movement-history.jsonl", lines);
}

/** Send a Discord webhook alert for a single movement. */
async function sendDiscordAlert(movement) {
  if (!DISCORD_WEBHOOK_URL) return;

  const lineInfo = movement.lineChanged
    ? `Line: ${movement.previous.line} → ${movement.current.line}`
    : "";
  const priceInfo = movement.priceChanged
    ? `Price: ${movement.previous.price} → ${movement.current.price}`
    : "";

  const message = [
    `📈 **Line Movement Detected**`,
    `**${movement.matchup}**`,
    `${movement.betType.toUpperCase()} (${movement.side}) — ${movement.bookmaker}`,
    lineInfo,
    priceInfo,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message }),
    });
  } catch (error) {
    console.error("Discord alert failed:", error.message);
  }
}

// ─── Main loop ────────────────────────────────────────────────────────────────

async function trackOdds() {
  console.log(`${new Date().toLocaleTimeString()} — Checking for line movement...`);

  for (const league of LEAGUES) {
    const events = await fetchOdds(league);

    if (events.length === 0) {
      console.log(`  No ${league} games found\n`);
      continue;
    }

    console.log(`  Tracking ${events.length} ${league} game(s)`);

    const allMovements = detectLineMovement(events);
    const significant = filterSignificantMoves(allMovements);

    displayMovements(significant);
    logMovementsToFile(significant);

    // Send a Discord alert for each significant move
    for (const movement of significant) {
      await sendDiscordAlert(movement);
    }
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────

if (!API_KEY) {
  console.error("Error: SPORTSGAMEODDS_KEY environment variable is not set.");
  console.error("Get a free key at https://sportsgameodds.com/pricing");
  process.exit(1);
}

console.log("Starting Live Odds Tracker — SportsGameOdds API");
console.log(`Leagues:  ${LEAGUES.join(", ")}`);
console.log(`Interval: ${POLL_INTERVAL / 1000}s`);
console.log(`Min move: ${MIN_LINE_MOVE} pts line / ${MIN_PRICE_MOVE} pts price\n`);

// Run immediately, then on interval
trackOdds();
setInterval(trackOdds, POLL_INTERVAL);
