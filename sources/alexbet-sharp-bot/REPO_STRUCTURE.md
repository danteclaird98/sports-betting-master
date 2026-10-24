# Repository Structure

This document describes the organization of the AlexBET Sharp Bot repository.

## 📁 Directory Overview

```
alexbet-sharp-bot/
├── 📄 Core Files
│   ├── telegram-bot.js              # Main bot orchestration (409 lines)
│   ├── claude-optimizer.js          # Claude AI token optimization utility
│   ├── package.json                 # Node.js dependencies & scripts
│   ├── .gitignore                   # Git ignore rules
│   └── .env.example                 # Environment variables template
│
├── 📚 Documentation (Root)
│   ├── README.md                    # Complete project guide (START HERE)
│   ├── FINAL_SUMMARY.md             # Implementation completion report
│   ├── IMPLEMENTATION_STATUS.md     # Phase-by-phase breakdown
│   ├── IMPLEMENTATION_SUMMARY.md    # Technical implementation details
│   ├── TASK_COMPLETION.md           # Rate limiter integration details
│   ├── TEST_RESULTS.md              # Integration test results
│   └── REPO_STRUCTURE.md            # This file
│
├── 📁 src/ (Source Code)
│   ├── handlers/                    # Command handlers (modular)
│   │   ├── start.js                 # /start command
│   │   ├── scan.js                  # /scan command (432 lines, most complex)
│   │   ├── stats.js                 # /stats command
│   │   ├── export.js                # Export handlers (csv/txt/json)
│   │   ├── bankroll.js              # /bankroll command
│   │   ├── timezone.js              # /timezone command + callbacks
│   │   ├── utils-commands.js        # Secondary commands (lite, help, api, etc.)
│   │   └── callback-handlers.js     # Unified callback_query routing
│   │
│   ├── services/                    # Business logic & integrations
│   │   ├── session-manager.js       # User session lifecycle (250+ lines)
│   │   ├── rateLimiter.js           # Rate limiting service
│   │   ├── tier-service.js          # Subscription tier logic
│   │   ├── auth.js                  # Permission/admin checks
│   │   ├── supabase-client.js       # Database client
│   │   ├── telegram-stars-payment.js # Telegram Stars integration
│   │   └── whop-payment.js          # Whop payment integration
│   │
│   ├── utils/                       # Utility functions
│   │   ├── gem-calculation.js       # Edge/EV calculation (fetchRealGems, Kelly)
│   │   ├── odds-conversion.js       # Odds math (American ↔ Implied ↔ Decimal)
│   │   ├── formatting.js            # Text formatting (dates, labels, emojis)
│   │   ├── retry-logic.js           # Exponential backoff retry
│   │   ├── date-parsing.js          # Game time parsing & sorting
│   │   ├── validation.js            # Input validation
│   │   ├── export-handler.js        # File export logic
│   │   └── logger.js                # Winston logging setup
│   │
│   ├── models/                      # Data models
│   │   └── tiers.js                 # Subscription tier definitions
│   │
│   └── test/                        # Tests
│       └── integration-test.js      # Integration test suite (432 lines, 23 tests)
│
├── 📁 docs/                         # Technical documentation
│   ├── BUGFIX_EDGE_CALCULATION.md   # Edge calculation bug fixes
│   ├── EXPORT_FEATURE.md            # Export feature documentation
│   ├── PRICING.md                   # Pricing model documentation
│   ├── TIER_IMPLEMENTATION.md       # Tier system implementation
│   └── SUPABASE_SCHEMA.sql          # Database schema SQL
│
├── 📁 scripts/                      # Setup & maintenance scripts
│   ├── create-tables.js             # Create Supabase tables
│   ├── init-db.js                   # Initialize database
│   ├── setup-supabase.js            # Supabase setup script
│   └── add-railway-vars.js          # Add Railway environment variables
│
└── 📁 logs/                         # Runtime logs (git-ignored)
    ├── error.log                    # Error logs only
    └── combined.log                 # All logs

```

## 📊 File Statistics

- **Total Source Files**: ~35 files
- **Main Bot**: 1 file (409 lines)
- **Handlers**: 8 files
- **Services**: 7 files
- **Utilities**: 8 files
- **Tests**: 1 comprehensive suite (23 tests, 100% pass)
- **Documentation**: 6 root docs + 5 technical docs
- **Scripts**: 4 setup scripts

## 🎯 File Organization Principles

### Handlers (`src/handlers/`)
- One file per Telegram command
- Exports: `regex`, `handler` async function, `setContext` function
- Pattern: Dependency injection for testability
- No global state (uses `setContext` for dependencies)

### Services (`src/services/`)
- Business logic and integrations
- Classes with methods (e.g., `SessionManager`, `RateLimiter`)
- Handle external APIs and database operations
- Exportable services with clear interfaces

### Utils (`src/utils/`)
- Pure functions and helpers
- No side effects (except logging)
- Focused on specific tasks (odds math, formatting, etc.)
- Reusable across handlers

### Tests (`src/test/`)
- Integration tests only (no unit tests yet)
- Tests handlers, services, and their interactions
- Mock objects for bot and external dependencies
- Run with: `node src/test/integration-test.js`

### Scripts (`scripts/`)
- One-time setup scripts
- Database initialization
- Environment configuration
- Not part of normal bot operation

### Docs (`docs/`)
- Technical deep-dives
- Feature documentation
- Schema reference (SQL)
- Separated from code but easily findable

## 🚀 Key Files to Know

| File | Purpose | Lines | Usage |
|------|---------|-------|-------|
| `telegram-bot.js` | Main bot orchestration | 409 | `npm start` |
| `README.md` | Getting started guide | 400+ | Read first |
| `FINAL_SUMMARY.md` | Project completion | 300+ | Audit reference |
| `src/handlers/scan.js` | Scan command (complex) | 432 | Core feature |
| `src/services/session-manager.js` | Session management | 250+ | State mgmt |
| `src/test/integration-test.js` | Test suite | 432 | `node src/test/integration-test.js` |

## 📝 Documentation Guide

1. **Start with `README.md`** - Full project overview
2. **Check `FINAL_SUMMARY.md`** - See what was accomplished
3. **Review `IMPLEMENTATION_STATUS.md`** - Understand the architecture
4. **Read `docs/*.md`** - Deep dive into specific features

## ✅ Best Practices

### Adding a New Command
1. Create `src/handlers/my-command.js`
2. Export: `regex`, `handler`, `setContext`
3. Register in `telegram-bot.js`
4. Add test to `src/test/integration-test.js`

### Adding a Service
1. Create `src/services/my-service.js`
2. Export class with methods
3. Add to `telegram-bot.js` initialization
4. Use dependency injection in handlers

### Adding a Utility
1. Create `src/utils/my-utility.js`
2. Export pure functions
3. Import where needed
4. Add tests for edge cases

## 🧹 What Was Cleaned Up

✅ Deleted:
- `docs/archive/` (60+ old session notes)
- `test/` root directory (old test files)
- `exports/` directory (sample data)
- `marketing/` (marketing assets)
- `telegram-bot-v2-recovered.js` (old backup)

✅ Updated:
- `.gitignore` (proper exclusions)
- Repository structure (cleaner organization)

---

**Last Updated**: April 23, 2026  
**Status**: Clean and organized for production
