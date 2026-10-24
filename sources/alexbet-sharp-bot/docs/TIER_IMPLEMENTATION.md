# Multi-Tier Implementation Guide

## Overview

This guide walks you through implementing the 4-tier subscription model into the AlexBET Sharp Bot.

---

## Architecture

```
┌─────────────────────────────────────────────┐
│       Telegram Bot (telegram-bot.js)        │
│  - /scan, /stats, /export commands          │
│  - Feature gate checks                      │
│  - Usage tracking                           │
└────────────────┬────────────────────────────┘
                 │
        ┌────────▼────────┐
        │  Tier Service   │
        │  (tier-service) │
        │  - Feature check│
        │  - Limits check │
        │  - Upgrade msgs │
        └────────┬────────┘
                 │
    ┌────────────▼────────────┐
    │    Tier Model Config    │
    │    (models/tiers.js)    │
    │  - TIERS definition     │
    │  - Feature matrix       │
    └────────────┬────────────┘
                 │
    ┌────────────▼────────────┐
    │  Supabase Database      │
    │  - users table          │
    │  - subscriptions table  │
    │  - usage table          │
    │  - scans table          │
    └─────────────────────────┘
```

---

## Phase 1: Setup Database

### Step 1: Run Schema in Supabase

1. Go to Supabase dashboard: https://app.supabase.com
2. Select your project
3. Go to SQL Editor
4. Create a new query
5. Paste entire content of `docs/SUPABASE_SCHEMA.sql`
6. Click "Run"

This creates:
- `users` table
- `subscriptions` table
- `scans` table
- `bets` table
- `usage` table
- `payments` table
- `audit_logs` table
- 2 useful views: `active_users`, `user_stats`

### Step 2: Create RLS (Row Level Security) Policies

The schema includes RLS policies. Ensure Supabase auth is configured:
- RLS enabled on all tables ✓
- Service role can bypass RLS ✓
- Users can see only their own data ✓

Test:
```sql
SELECT * FROM users;  -- Should return only current user's data
```

---

## Phase 2: Update Bot Code

### Step 1: Import Tier System

In `telegram-bot.js`:

```js
const { getTier, hasFeature, getScanLimit } = require('./src/models/tiers');
const tierService = require('./src/services/tier-service');
```

### Step 2: Load User Subscription on Start

When user sends `/start` or `/scan`:

```js
async function getUserSubscription(userId) {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error && error.code !== 'PGRST116') {
    logger.error('Failed to load subscription', { userId, error });
    return null;
  }

  // Create free tier if no subscription exists
  if (!data) {
    return {
      tier_id: 'free',
      status: 'active'
    };
  }

  return data;
}
```

### Step 3: Add Feature Gates to /scan

Before executing scan:

```js
bot.onText(/\/scan/, async (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;

  // Load subscription
  const subscription = await getUserSubscription(userId);
  const user = { id: userId, subscription };

  // Check if user can scan
  const canScan = tierService.canUserPerformAction(user, 'scans_per_day');
  if (!canScan.allowed) {
    bot.sendMessage(chatId, `❌ ${canScan.reason}`);
    return;
  }

  // Check daily scan limit
  const scansToday = await getScanCountForToday(userId);
  const limitCheck = tierService.validateScanLimit(user, scansToday);
  
  if (!limitCheck.valid) {
    bot.sendMessage(chatId, limitCheck.message);
    return;
  }

  // Proceed with scan...
  logger.info('Scan allowed', {
    userId,
    tierId: subscription.tier_id,
    scansRemaining: limitCheck.remaining
  });
});
```

### Step 4: Track Usage

After successful scan:

```js
async function trackScanUsage(userId, tierId) {
  const today = new Date().toISOString().split('T')[0];

  const { error } = await supabase
    .from('usage')
    .upsert(
      {
        user_id: userId,
        date: today,
        scans_used: 1, // Increment by 1
        tier_id: tierId
      },
      { onConflict: 'user_id,date' }
    );

  if (error) {
    logger.error('Failed to track usage', { userId, error });
  }
}
```

### Step 5: Add Upgrade Prompts

When user hits limit:

```js
bot.sendMessage(chatId, `
⏳ You've reached your scan limit for today!

${tierService.generateUpgradeMessage(subscription.tier_id)}

💳 Get instant unlimited access
https://whop.com/alexbet/
`);
```

---

## Phase 3: Claude AI Gating

### Haiku (Sharp Tier)
```js
const models = tierService.getUserClaudeModels(user);

if (models.includes('claude-3-sonnet')) {
  // Use Sonnet for better analysis
  analysis = await claudeOptimizer.analyzeGame(gem, 'sonnet');
} else if (models.includes('claude-3-haiku')) {
  // Fall back to Haiku
  analysis = await claudeOptimizer.analyzeGame(gem, 'haiku');
}
```

### Allow Upgrade During Analysis

```js
if (!tierService.hasFeature(tierId, 'claude_analysis')) {
  bot.sendMessage(chatId, `
🤖 Claude AI Analysis (Sharp+ feature)

Want AI-powered edge detection?
Upgrade to Sharp for $49/month

${tierService.getFeatureList('sharp')}

Upgrade: https://whop.com/alexbet/
  `);
  return;
}
```

---

## Phase 4: Whop Integration

### Step 1: Get Whop API Key

1. Sign up at https://whop.com
2. Create product: "AlexBET Sharp Bot"
3. Add pricing tiers
4. Get API key from settings

### Step 2: Webhook Setup

Whop sends webhook when user subscribes:

```js
const express = require('express');
const app = express();

app.post('/webhooks/whop', async (req, res) => {
  const event = req.body;

  if (event.type === 'subscription.created') {
    const userId = event.data.customer_id;
    const tierId = event.data.product_id; // Should map to tier

    // Create subscription in database
    await supabase
      .from('subscriptions')
      .upsert({
        user_id: userId,
        tier_id: tierId,
        status: 'active',
        payment_provider: 'whop',
        payment_provider_id: event.data.subscription_id
      });

    logger.info('Subscription created', { userId, tierId });
  }

  res.json({ ok: true });
});
```

### Step 3: Map Whop Products to Tiers

Create mapping file `config/whop-mapping.js`:

```js
module.exports = {
  'prod_sharp_tier': 'sharp',     // Whop product ID → tier
  'prod_elite_tier': 'elite',
  'prod_enterprise': 'enterprise'
};
```

---

## Phase 5: Feature Gates in Bot

### Example: Player Props

```js
if (!tierService.hasFeature(tierId, 'player_props')) {
  bot.sendMessage(chatId, `
🎭 Player Props (Sharp+ feature)

Player prop opportunities unlock at Sharp tier!

Current: Free ($0)
Required: Sharp ($49/month)

Upgrade now: https://whop.com/alexbet/
  `);
  return;
}

// Continue with player props...
```

### Example: Ask Alex

```js
if (!tierService.hasFeature(tierId, 'ask_alex')) {
  bot.sendMessage(chatId, `
🧠 Ask Alex Custom Analysis (Elite feature)

Get personalized AI analysis of any game!

Current: ${getTier(tierId).name}
Required: Elite ($99/month)

Upgrade: https://whop.com/alexbet/
  `);
  return;
}

// Process Ask Alex request...
```

### Example: API Access

```js
if (!tierService.hasFeature(tierId, 'api_access')) {
  return res.status(403).json({
    error: 'API access requires Elite tier',
    upgrade_url: 'https://whop.com/alexbet/'
  });
}

// Return API data...
```

---

## Phase 6: User Commands

### /tier Command
Show current tier and features:

```js
bot.onText(/\/tier/, async (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;

  const subscription = await getUserSubscription(userId);
  const tier = getTier(subscription.tier_id);

  bot.sendMessage(chatId, `
${tierService.formatTierInfo(subscription)}

${tierService.getFeatureList(subscription.tier_id)}

Compare all tiers: /pricing
Upgrade: https://whop.com/alexbet/
  `);
});
```

### /pricing Command
Show all tiers:

```js
bot.onText(/\/pricing/, (msg) => {
  const chatId = msg.chat.id;

  bot.sendMessage(chatId, `
*💎 AlexBET Tier Comparison*

🟢 FREE - $0
  • 5 scans/day
  • Basic edge detection

🟡 SHARP - $49/mo
  • 100 scans/day
  • Claude AI analysis
  • Player props

🔵 ELITE - $99/mo
  • Unlimited scans
  • Team props
  • Ask Alex
  • API access

🔴 ENTERPRISE
  • Custom everything
  • Dedicated support
  • White-label

→ https://whop.com/alexbet/
  `, { parse_mode: 'Markdown' });
});
```

### /upgrade Command
Direct upgrade link:

```js
bot.onText(/\/upgrade/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, `
💳 Upgrade your AlexBET subscription

→ https://whop.com/alexbet/

Questions? Reply with /support
  `);
});
```

---

## Phase 7: Testing

### Test Data Setup

```sql
-- Create test users
INSERT INTO users (id, username, first_name, bankroll)
VALUES
  (111111111, 'testfree', 'Test', 100),
  (222222222, 'testsharp', 'Test', 100),
  (333333333, 'testelite', 'Test', 100);

-- Create subscriptions
INSERT INTO subscriptions (user_id, tier_id)
VALUES
  (111111111, 'free'),
  (222222222, 'sharp'),
  (333333333, 'elite');
```

### Test Checklist

- [ ] Free user hits scan limit → sees upgrade prompt
- [ ] Sharp user can use Claude analysis
- [ ] Elite user can access Ask Alex
- [ ] Non-paid features show upgrade message
- [ ] Whop webhook creates subscription
- [ ] Usage tracking increments daily
- [ ] Features gate correctly per tier
- [ ] Tier info displays accurately

---

## Phase 8: Monitoring

### Key Metrics to Track

```js
logger.info('Feature access check', {
  userId,
  tierId,
  feature,
  allowed,
  reason
});

logger.info('Scan used', {
  userId,
  tierId,
  scansUsedToday,
  scanLimit,
  remaining
});

logger.info('Upgrade prompt shown', {
  userId,
  reason: 'scan_limit_hit',
  fromTier
});
```

### Dashboards to Create
1. **Conversion Funnel**: Free → Sharp → Elite
2. **Tier Distribution**: % of users in each tier
3. **Usage by Tier**: Scans, API calls, features used
4. **Revenue**: MRR by tier, churn rate

---

## Troubleshooting

### User doesn't see upgrade prompt
- Check: Subscription exists in DB
- Check: Feature gates are configured
- Check: Bot has fresh subscription data

### Tier limit not working
- Verify: `usage` table has today's entry
- Verify: `getScanLimit()` returns correct number
- Check: Daily increment working

### Whop webhook not firing
- Verify: Webhook URL configured in Whop
- Verify: Endpoint receiving POST requests
- Check: Payload matches expectation
- Test: Send test event from Whop dashboard

---

## Deployment Checklist

- [ ] Database schema deployed (SUPABASE_SCHEMA.sql)
- [ ] Tier models configured (models/tiers.js)
- [ ] Tier service integrated (services/tier-service.js)
- [ ] Feature gates in bot code
- [ ] Whop webhooks configured
- [ ] Usage tracking implemented
- [ ] Upgrade prompts in UI
- [ ] Commands: /tier, /pricing, /upgrade
- [ ] Test all tiers with test users
- [ ] Monitor logs in production
- [ ] Set up conversion tracking

---

## Next Steps

1. **Week 2**: Deploy database schema
2. **Week 3**: Implement feature gates
3. **Week 4**: Whop integration
4. **Week 5**: Upgrade funnel optimization
5. **Week 6**: Production monitoring setup

---

## Support

Questions? Check:
- `/docs/PRICING.md` - Pricing details
- `/src/models/tiers.js` - Tier configuration
- `/src/services/tier-service.js` - Service methods
- Supabase docs: https://supabase.com/docs
