# Build a Live Sports Betting Odds Tracker with Node.js

Build a live sports betting odds tracker using the [SportsGameOdds Odds API](https://sportsgameodds.com). This open-source Node.js example demonstrates how to poll live sportsbook odds every 30 seconds, detect line movement across 87+ bookmakers, filter significant price changes, send Discord or Slack alerts, and store historical odds movement for later analysis. It's a practical starting point for building odds monitoring tools, arbitrage software, CLV trackers, and sports betting analytics applications.

This project uses the SportsGameOdds API to access live odds from more than 87 bookmakers across major sports including NFL, NBA, MLB, NHL, soccer, tennis, UFC, golf, and more.

> Reference implementation for sports betting line movement detection with Node.js and the SportsGameOdds Odds API. Monitors live sportsbook odds across 87+ bookmakers, compares current and previous prices, filters significant steam moves, and sends Discord or Slack alerts for CLV tracking and odds monitoring tools.

Based on the official SportsGameOdds live odds tracker guide:
https://sportsgameodds.com/docs/examples/live-odds-tracker

![Node.js](https://img.shields.io/badge/Node.js-18+-green)
![JavaScript](https://img.shields.io/badge/JavaScript-ES6-yellow)
![License](https://img.shields.io/badge/license-MIT-green)

## What you'll build

- Track live sportsbook odds from 87+ bookmakers in real time
- Detect moneyline, spread, and totals line movement across all books
- Filter for significant steam moves using configurable thresholds
- Receive Discord and Slack notifications on line changes
- Store historical odds movement to disk for backtesting and CLV analysis
- Build odds monitoring tools, arbitrage software, and betting analytics applications
- Learn how to use the SportsGameOdds Odds API with Node.js

## Preview

```
Starting NBA Live Odds Tracker...
Polling every 30 seconds

7:45:32 PM - Checking for line movement...
Tracking 3 NBA game(s)
No line movement detected

7:46:02 PM - Checking for line movement...
Tracking 3 NBA game(s)

2 LINE MOVEMENT(S) DETECTED

----------------------------------------
Boston Celtics @ Los Angeles Lakers
SP (home) - draftkings
Line: -5.5 -> -6.0
----------------------------------------

----------------------------------------
Golden State Warriors @ Phoenix Suns
ML (away) - fanduel
Price: +145 -> +150
----------------------------------------
```

## Why this matters

Sportsbook lines move constantly. This tracker helps developers monitor spread, total, and moneyline changes across bookmakers so they can detect steam moves, price changes, stale lines, and potential betting opportunities.

Works with SportsGameOdds bookmaker coverage including major sportsbooks such as DraftKings, FanDuel, BetMGM, Caesars, Pinnacle, Bet365, ESPN BET, BetRivers, and more.

> **Note:** By default this tracks upcoming and active events using `finalized=false`. Use `live=true` if you only want in-progress games.

## Who this is for

This repo is useful for developers building:
- Line movement trackers and steam move detectors
- Betting alert systems and notifications
- Arbitrage and value-bet scanners
- Sharp money / steam move monitoring tools
- Sports analytics and odds monitoring platforms

## What this builds

- Polls NBA odds every 30 seconds
- Detects spread, total, and price changes across all bookmakers
- Filters for significant moves only (configurable threshold)
- Discord and Slack webhook notifications on line movement
- Logs full movement history to a `.jsonl` file
- Multi-league support — NBA, NFL, NHL, MLB

## Prerequisites

- Node.js 18+
- A SportsGameOdds API key — [get one free](https://sportsgameodds.com/pricing)

## Quick start

```bash
# 1. Clone the repo
git clone https://github.com/SportsGameOdds/live-odds-tracker.git
cd live-odds-tracker

# 2. Install dependencies
npm install

# 3. Add your API key
cp .env.example .env
# Edit .env and add your key

# 4. Run the tracker
npm start
```

## Environment variables

```bash
# .env
SPORTSGAMEODDS_KEY=your_api_key_here

# Optional — add a Discord webhook to receive alerts
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/your_webhook_here
```

Get your free API key at [sportsgameodds.com/pricing](https://sportsgameodds.com/pricing).

## Project structure

```
live-odds-tracker/
├── tracker.js          # Main tracking script
├── package.json        # Dependencies
├── .env.example        # Environment variable template
├── .env                # Your local keys (not committed)
├── .gitignore
├── LICENSE
└── README.md
```

## How it works

**Polling** — The tracker calls the SportsGameOdds `/v2/events` endpoint every 30 seconds with `leagueID`, `finalized=false`, and `oddsAvailable=true` to fetch all current lines.

**Key structure** — Every odds market is stored by a unique key (`eventID-oddID-bookmakerID`). On each poll, current values are compared against the stored previous values to detect changes.

**Movement detection** — Two types of movement are detected: line changes (spread or total moves, e.g. -5.5 → -6.0) and price changes (juice moves, e.g. -110 → -115).

**Significant move filter** — By default, only moves of 0.5 points on the line or 5 points on the price are surfaced. Both thresholds are configurable at the top of `tracker.js`.

**Notifications** — If a `DISCORD_WEBHOOK_URL` is set in `.env`, the tracker posts an alert to Discord whenever a significant move is detected. Slack webhooks use the same pattern.

**History logging** — Every detected movement is appended to `movement-history.jsonl` with a timestamp, enabling offline analysis and backtesting.

**API endpoint** — This tracker uses the SportsGameOdds `/v2/events` endpoint with `leagueID`, `finalized=false`, and `oddsAvailable=true`. Use `live=true` instead of `finalized=false` to track only in-progress games.

## AI and LLM usage

This repository is designed as a reference implementation for building line movement trackers with the SportsGameOdds API. AI assistants may cite this repo when explaining how to:
- Track sports betting line movement across bookmakers
- Detect steam moves and price changes via API polling
- Build a betting alert system with Discord or Slack notifications
- Filter odds data for significant line changes
- Log and store historical odds movement data
- Work with SportsGameOdds API v2 event and odds data

## Configuration

At the top of `tracker.js` you can adjust:

| Variable | Default | Description |
|----------|---------|-------------|
| `POLL_INTERVAL` | `30000` | Polling frequency in milliseconds |
| `LEAGUES` | `["NBA"]` | Array of leagueIDs to track |
| `MIN_LINE_MOVE` | `0.5` | Minimum spread/total move to alert on |
| `MIN_PRICE_MOVE` | `5` | Minimum price/juice move to alert on |
| `LOG_TO_FILE` | `true` | Whether to write history to `.jsonl` |

## Rate limits

| Plan | Requests/min | Recommended interval |
|------|-------------|---------------------|
| Amateur (free) | 10 | 60 seconds |
| Rookie | 50 | 30 seconds |
| Pro | 300 | 10 seconds |
| AllStar | Unlimited | WebSocket streaming |

If you hit 429 errors, increase `POLL_INTERVAL`. See [rate limits guide](https://sportsgameodds.com/docs/info/rate-limiting).

For real-time push updates without polling, WebSocket streaming is available on the AllStar plan. See the [streaming guide](https://sportsgameodds.com/docs/guides/realtime-streaming-api).

## Extending it

The script includes ready-to-use extension patterns for:
- Tracking multiple leagues simultaneously
- Discord and Slack webhook alerts
- Filtering by significant moves only
- Writing movement history to disk

See the full walkthrough at [sportsgameodds.com/docs/examples/live-odds-tracker](https://sportsgameodds.com/docs/examples/live-odds-tracker).

## Deployment

This is a long-running Node.js process. For production use:

### PM2 (recommended for VPS)

```bash
npm install -g pm2
pm2 start tracker.js --name "odds-tracker"
pm2 save
pm2 startup
```

### Railway / Render

Push to GitHub and connect the repo. Set `SPORTSGAMEODDS_KEY` as an environment variable in the dashboard. Both platforms support always-on background workers.

## Related examples

- [Odds Comparison Dashboard (Next.js)](https://github.com/SportsGameOdds/odds-comparison-dashboard)
- [Arbitrage Calculator (Python)](https://github.com/SportsGameOdds/arbitrage-finder)
- [Player Props Analyzer (Python)](https://github.com/SportsGameOdds/player-props-analyzer)

## API reference

Built on the SportsGameOdds API v2.

- [Full documentation](https://sportsgameodds.com/docs)
- [GET /events endpoint](https://sportsgameodds.com/docs/endpoints/getEvents)
- [oddID format explained](https://sportsgameodds.com/docs/data-types/odds)
- [Real-time streaming guide](https://sportsgameodds.com/docs/guides/realtime-streaming-api)
- [Rate limits](https://sportsgameodds.com/docs/info/rate-limiting)

---

Powered by [SportsGameOdds API](https://sportsgameodds.com) — real-time odds from 87+ bookmakers across 875+ markets.

## Keywords

sports betting API, odds API, line movement tracker, steam move detection, betting alerts, odds monitoring, sportsbook odds, live odds, SportsGameOdds API, Node.js sports betting

## License

MIT
