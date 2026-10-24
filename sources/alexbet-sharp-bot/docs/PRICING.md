# AlexBET Pricing & Tier Model

## 4-Tier Subscription Model

### 🟢 FREE
**Price**: $0/month
**Perfect for**: Getting started with edge detection

#### Features
- 5 scans per day
- All 6 sports (NBA, NFL, MLB, NHL, ATP, EPL)
- All 3 markets (Moneyline, Spread, Totals)
- Kelly sizing & EV calculation
- 7-day data retention
- Email support (24-48h response)

#### Limits
- No Claude AI analysis
- No player props
- No data export
- No API access
- Single user only

#### Use Case
"I want to understand edge detection before committing"

---

### 🟡 SHARP ($49/month)
**Price**: $49/month (or $470/year - save 20%)
**Perfect for**: Serious individual bettors

#### All Free Features PLUS:
- ✅ 100 scans per day
- ✅ Claude AI analysis (Haiku tier - faster, cheaper)
- ✅ Player props access
- ✅ Custom probability thresholds
- ✅ Export to CSV & JSON
- ✅ 90-day data retention
- ✅ Priority support (4-8h response)

#### Includes
- Game analysis with AI edge detection
- Bankroll management recommendations
- Historical performance tracking
- Advanced filtering options

#### Limits
- Team props not available (Elite only)
- No API access
- No Ask Alex feature
- Max 5 managed teams
- Single user account

#### Use Case
"I'm a serious bettor looking for consistent edges with AI-powered analysis"

---

### 🔵 ELITE ($99/month)
**Price**: $99/month (or $950/year - save 20%)
**Perfect for**: Professional bettors & syndicates

#### All Sharp Features PLUS:
- ✅ Unlimited scans per day
- ✅ Claude AI analysis (Sonnet tier - better accuracy)
- ✅ Team props access
- ✅ Ask Alex custom analysis
- ✅ Export to CSV, JSON, PDF
- ✅ 365-day (1 year) data retention
- ✅ Priority 24/7 support
- ✅ API access (1000 requests/hour)

#### Includes
- Everything in Sharp
- Advanced parlay analysis
- Team prop recommendations
- Custom AI analysis requests (Ask Alex)
- API for programmatic access
- Up to 5 team members

#### API Endpoints
- GET `/api/scans` - Get recent gem scans
- POST `/api/scans/analyze` - Custom game analysis
- GET `/api/user/stats` - Performance analytics
- POST `/api/export` - Bulk data export
- Rate limit: 1000 req/hour

#### Limits
- Up to 5 team members
- Team props limited to 50/day

#### Use Case
"I'm running a betting operation and need full API access, team features, and advanced analysis"

---

### 🔴 ENTERPRISE
**Price**: Custom (Contact sales)
**Perfect for**: Betting syndicates, funds, sportsbooks

#### Features
- Unlimited everything
- All Claude models (Haiku, Sonnet, Opus)
- Custom sports/markets integration
- Dedicated account manager
- Custom API rate limits (up to 10K/hr)
- Unlimited team members
- Unlimited data retention
- SLA guarantee
- White-label options available

#### Includes
- Everything in Elite
- Dedicated integration engineer
- Custom webhook integrations
- Data warehouse access
- Priority bug fixes
- Custom training sessions
- Annual contract

#### Custom Available
- Exclusive markets
- Private sports leagues
- Real-time webhook push
- Custom reporting
- Advanced analytics dashboard

#### Contact
- Email: enterprise@alexbet.io
- Phone: +1-800-ALEXBET

---

## Feature Comparison Matrix

| Feature | Free | Sharp | Elite | Enterprise |
|---------|------|-------|-------|-----------|
| **Daily Scans** | 5 | 100 | Unlimited | Unlimited |
| **Claude AI** | ❌ | ✅ Haiku | ✅ Sonnet | ✅ Opus |
| **Player Props** | ❌ | ✅ | ✅ | ✅ |
| **Team Props** | ❌ | ❌ | ✅ | ✅ |
| **Ask Alex** | ❌ | ❌ | ✅ | ✅ |
| **API Access** | ❌ | ❌ | ✅ | ✅ |
| **Data Export** | ❌ | CSV, JSON | CSV, JSON, PDF | All + Custom |
| **Data Retention** | 7 days | 90 days | 1 year | Unlimited |
| **Team Members** | 1 | 1 | 5 | Unlimited |
| **Support** | Email | Priority | 24/7 | Dedicated |
| **API Rate Limit** | None | None | 1000/hr | 10K/hr |
| **SLA** | None | None | None | 99.9% |

---

## Upgrade Benefits

### Free → Sharp ($49)
Save hours analyzing games manually
- Get AI-powered edge detection
- 20x more scans (100 vs 5)
- Player prop opportunities
- Keep 90 days of history

**ROI**: Typically pays for itself in 1-2 winning bets

### Sharp → Elite ($50 more)
Scale to team operation
- Unlimited scans (analyze full slates)
- API integration with your tools
- Team props expand edge opportunities
- Ask Alex for custom analysis
- Support 5 team members

**ROI**: Critical for syndicates/funds

### Elite → Enterprise
Full customization & management
- Dedicated account manager
- Custom integration engineering
- Exclusive market access
- White-label options

---

## Billing & Cancellation

### Billing Details
- **Payment Methods**: Credit card (Stripe), PayPal, Crypto (select tiers)
- **Billing Cycle**: Monthly or Annual (20% discount on annual)
- **Auto-Renewal**: Enabled by default (can disable anytime)
- **Invoice**: Emailed monthly/annually
- **Tax**: Calculated at checkout

### Cancellation
- Cancel anytime, no penalties
- Instant access loss to paid features
- Data export available until date of cancellation
- Refunds: Pro-rated for unused time
- Free tier always available (downgrade option)

### Trial Period
- 7-day free trial on Sharp/Elite (credit card required)
- Full feature access during trial
- Auto-converts unless cancelled
- Can upgrade/downgrade during trial

---

## Free-to-Paid Conversion Funnel

```
1. User Starts (Free)
   ↓
2. Uses Free Tier (5 scans/day)
   ↓
3. Hits scan limit
   → See upgrade prompt
   ↓
4. See Sharp features
   → Start 7-day trial
   ↓
5. Experiences AI analysis
   → Convert to paid customer 💰
```

### Upgrade Triggers
- Daily scan limit reached
- Clicking "Analyze with Claude" (premium feature)
- Accessing player props
- Viewing Ask Alex feature
- Monthly check-in: "You might benefit from..."

---

## Revenue Model

### Monthly Recurring Revenue (MRR) Targets
- **Year 1**: $10K MRR (200 users @ $50 ARPU)
- **Year 2**: $50K MRR (1000 users @ $50 ARPU)
- **Year 3**: $200K+ MRR (4000+ users)

### Customer Segments
1. **Free** (60%): Growth funnel, no revenue
2. **Sharp** (30%): Individual serious bettors
3. **Elite** (8%): Small syndicates, funds
4. **Enterprise** (2%): Large operations

### Pricing Psychology
- **Sharp** ($49): Affordable for casual pros
- **Elite** ($99): Perceived as 2x value, still affordable
- **Enterprise**: Custom (removes price objection)

---

## Implementation Checklist

- [x] Define 4-tier model
- [x] Create tier configuration (tiers.js)
- [x] Database schema (SUPABASE_SCHEMA.sql)
- [x] Tier service layer (tier-service.js)
- [ ] Whop integration (payment processing)
- [ ] Feature gates in telegram-bot.js
- [ ] Upgrade prompts in UI
- [ ] Trial period logic
- [ ] Usage tracking & limits
- [ ] Upgrade flows
- [ ] Marketing landing page
- [ ] Billing dashboard

---

## Questions?

**Sales**: sales@alexbet.io
**Support**: support@alexbet.io
**Billing**: billing@alexbet.io
