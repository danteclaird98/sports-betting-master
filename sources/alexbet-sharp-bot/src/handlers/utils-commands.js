/**
 * Utility command handlers
 * Consolidates: lite, help, terms, support, api, calculator, compare, alerts, status
 */

const logger = require('../utils/logger');
const { getSubscriptionDetails } = require('../services/auth');

let bot;

function setContext(botInstance) {
  bot = botInstance;
}

function handleLite(msg) {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, `
📊 *AlexBET Lite*

Track every bet with CLV analysis:

🔗 https://alexbet-lite.netlify.app

✅ Log entry odds when you place bet
✅ Update closing odds when game starts
✅ Track win rate & CLV
✅ Validate your edge

🎯 Target: 56-65% win rate + positive CLV
  `, { parse_mode: 'Markdown' });
}

function handleAlerts(msg, match) {
  const chatId = msg.chat.id;
  const platform = match[1]?.toLowerCase();
  const webhookUrl = match[2]?.trim();

  // TODO: Store alertConfig from main file
  const alertConfig = {
    discordWebhook: process.env.DISCORD_WEBHOOK_URL || null,
    slackWebhook: process.env.SLACK_WEBHOOK_URL || null
  };

  if (!platform) {
    bot.sendMessage(chatId, `
🔘 *Configure Discord/Slack Alerts*

Usage:
/alerts discord WEBHOOK_URL
/alerts slack WEBHOOK_URL

🔗 Get webhook from Discord/Slack settings
📔 Status:
- Discord: ${alertConfig.discordWebhook ? '✅' : '❌'}
- Slack: ${alertConfig.slackWebhook ? '✅' : '❌'}
    `, { parse_mode: 'Markdown' });
    return;
  }

  if (!webhookUrl) {
    bot.sendMessage(chatId, '❌ Please provide webhook URL');
    return;
  }

  if (platform === 'discord') {
    alertConfig.discordWebhook = webhookUrl;
    bot.sendMessage(chatId, '✅ Discord webhook configured!');
  } else if (platform === 'slack') {
    alertConfig.slackWebhook = webhookUrl;
    bot.sendMessage(chatId, '✅ Slack webhook configured!');
  }
}

async function handleCompare(msg, match) {
  const chatId = msg.chat.id;
  const team = match[1]?.trim();
  const odds = parseFloat(match[2]);

  if (!team || isNaN(odds)) {
    bot.sendMessage(chatId, '❌ Usage: /compare TEAM_NAME ODDS\n\nExample: /compare HEAT -110');
    return;
  }

  bot.sendMessage(chatId, `🔍 Comparing odds for ${team} @ ${odds > 0 ? '+' : ''}${odds}...`);

  try {
    // Simulate odds comparison (would fetch from real Odds API in production)
    const books = [
      { name: 'FanDuel', odds: odds - 5, diff: -5 },
      { name: 'DraftKings', odds: odds, diff: 0 },
      { name: 'BetMGM', odds: odds - 10, diff: -10 },
      { name: 'Caesars', odds: odds - 15, diff: -15 },
      { name: 'PointsBet', odds: odds - 8, diff: -8 }
    ];

    // Sort by best odds (highest for favorites, lowest for underdogs)
    const sorted = odds < 0 ? books.sort((a, b) => b.odds - a.odds) : books.sort((a, b) => a.odds - b.odds);

    let response = `
*${team}* | ${odds > 0 ? '+' : ''}${odds}

📊 *Best Lines:*
`;

    sorted.forEach((book, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '';
      const diffStr = book.diff > 0 ? `(+${book.diff})` : book.diff < 0 ? `(${book.diff})` : '(BEST)';
      response += `${medal} ${book.name}: ${book.odds > 0 ? '+' : ''}${book.odds} ${diffStr}\n`;
    });

    // Calculate savings
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    const savingsPercentPerBet = Math.abs(worst.diff);

    response += `
💰 *Savings (vs worst line):*
$50 bet: +$${(savingsPercentPerBet * 50 / 100).toFixed(0)}
$100 bet: +$${(savingsPercentPerBet * 100 / 100).toFixed(0)}
$500 bet: +$${(savingsPercentPerBet * 500 / 100).toFixed(0)}

🎯 *Recommendation:* Bet on ${best.name}
    `;

    bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('[/compare error]', err.message);
    bot.sendMessage(chatId, '❌ Error fetching odds. Try again later.');
  }
}

function handleCalculator(msg) {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, `
💰 *Custom Edge Calculator*

Define your own betting formula:

*Example formulas:*
- Simple: Win % - Vig
- Weighted: (Win % * 0.7) + (CLV * 0.3)
- Advanced: (WinRate - 0.5) * Odds * Kelly

📑 *How to set up:*
1. Visit https://alexbet-lite.netlify.app
2. Go to Settings tab
3. Enter your formula
4. Bot will calculate dual-model comparison

🔍 *Your Model vs Bot Model:*
Bot shows:
- Your predicted edge
- Bot's calculated edge
- Blend recommendation (weighted average)
- Which model to use
  `, { parse_mode: 'Markdown' });
}

function handleAPI(msg) {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, `
🔗 *AlexBET Sharp REST API*

Integrate with Excel, Airtable, or custom tools:

*Endpoints:*
\`GET /api/bets\` — Your bets
\`GET /api/stats\` — Performance stats
\`GET /api/signals\` — Today's gems
\`POST /api/bets\` — Create bet
\`GET /api/health\` — Health check

*Authentication:*
Header: \`X-API-Key: YOUR_KEY\`

*Example (cURL):*
\`curl -H 'X-API-Key: demo-key' http://api.alexbet.io/api/stats\`

💼 *Premium feature ($99/mo)*
White-label API + unlimited requests

📧 Contact support for API key
  `, { parse_mode: 'Markdown' });
}

async function handleStatus(msg) {
  try {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    
    const subscriptionDetails = await getSubscriptionDetails(userId);
    
    // Get current server time (America/Phoenix = MST)
    const now = new Date();
    const timeString = now.toLocaleString('en-US', { 
      timeZone: 'America/Phoenix',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
    
    let statusMsg = '📊 **Your Subscription Status**\n\n';
    statusMsg += `🕐 **Server Time:** ${timeString} MST\n\n`;
    
    if (subscriptionDetails.tier === 'free') {
      statusMsg += '**Status:** 🆓 Free Tier\n';
      statusMsg += '**Gems:** 3 per scan\n';
      statusMsg += '**Markets:** Moneyline only\n';
      statusMsg += '**Export:** Disabled\n\n';
      statusMsg += '💡 Upgrade for unlimited access:\n/subscribe';
    } else {
      statusMsg += `**Status:** ✅ ${subscriptionDetails.tier.toUpperCase()}\n`;
      statusMsg += `**Product:** ${subscriptionDetails.product_name}\n`;
      statusMsg += `**Gems:** ${subscriptionDetails.gems} per scan\n`;
      statusMsg += `**Markets:** ${subscriptionDetails.markets.join(', ')}\n`;
      statusMsg += `**Export:** ${subscriptionDetails.export ? '✅ Enabled' : '❌ Disabled'}\n`;
      
      if (subscriptionDetails.expires_at) {
        const expiryDate = new Date(subscriptionDetails.expires_at);
        const daysLeft = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));
        statusMsg += `**Expires:** ${expiryDate.toLocaleDateString()}\n`;
        
        if (daysLeft <= 7 && daysLeft > 0) {
          statusMsg += `\n⏰ _Renewal coming soon!_ (${daysLeft} days left)\n/subscribe to extend`;
        } else if (daysLeft <= 0) {
          statusMsg += '\n❌ _Subscription expired_\n/subscribe to renew';
        } else {
          statusMsg += `\n✅ Enjoy your premium access! (${daysLeft} days left)`;
        }
      } else {
        statusMsg += '\n✅ Lifetime access - No expiration';
      }
    }
    
    await bot.sendMessage(chatId, statusMsg, { parse_mode: 'Markdown' });
  } catch (err) {
    logger.error('Error in /status command:', err);
    bot.sendMessage(msg.chat.id, '❌ Error checking status. Please try again.');
  }
}

function handleTerms(msg) {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, `
📋 Terms & Conditions

AlexBET Sharp Bot by Oddsify Labs

1. SUBSCRIPTION
• 1-year subscription automatically set to expire
• You can cancel anytime
• No refunds after 7 days

2. DIGITAL GOODS
• Ebook license for personal use only
• No distribution or resale
• All content copyright Oddsify Labs

3. PAYMENT
• Powered by Telegram Stars
• Payments are final (see refund policy)
• All amounts in USD equivalent

4. DISCLAIMERS
• Past performance ≠ future results
• Sports betting carries risk
• We provide analysis, not guarantees
• You are responsible for your bets

5. REFUNDS
• Full refund within 7 days if unopened
• No refund after 7 days
• Disputes handled via /paysupport

6. LIABILITY
• We are not liable for losses
• Use at your own risk
• Comply with all local laws

By using this bot, you agree to these terms.

Questions? /support
  `);
}

function handleSupport(msg) {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, `
💬 Support & Help

For issues, email: support@oddsifylabs.com

Common Issues:

❓ Didn't receive resources?
Email support@oddsifylabs.com

❓ Bot features not working?
Try /help or restart the bot

❓ Subscription issue?
Email support with transaction ID

❓ Payment problems?
Use /paysupport for payment issues

❓ General questions?
Email: support@oddsifylabs.com

We respond within 24 hours.
  `);
}

function handlePaySupport(msg) {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, `
💳 Payment Support

For payment disputes or refund requests:

📧 Email: support@oddsifylabs.com

Include:
✅ Transaction ID (from receipt)
✅ Date of purchase
✅ Issue description
✅ Preferred resolution

Refund Policy:
• Full refund within 7 days (unopened products)
• 50% refund days 7-30
• No refunds after 30 days
• Disputes resolved within 48 hours

We're here to help!
  `);
}

function handleHelp(msg) {
  const chatId = msg.chat.id;
  const helpMsg = `📊 *AlexBET Sharp Bot - Command Menu*

🔍 *SCANNING*
/scan - Find top +EV gems
/stats - View performance stats

📥 *EXPORT (Premium)*
/export - Export scan results
  • /export_txt - Download as TXT (recommended)
  • /export_csv - Download as CSV
  • /export_json - Download as JSON

⚙️ *SETTINGS*
/bankroll - Set betting bankroll
/status - Check subscription status

💳 *PREMIUM*
/subscribe - View subscription tiers
/pricing - Pricing & features

📖 *INFO*
/lite - AlexBET Lite tracker
/terms - Terms & Conditions
/support - Customer support
/help - This menu

💡 Tip: Run /scan first, then /export!

📱 https://alexbet-lite.netlify.app
⭐ /subscribe to upgrade`;
  
  bot.sendMessage(chatId, helpMsg, { parse_mode: 'Markdown' });
}

module.exports = {
  handleLite,
  handleAlerts,
  handleCompare,
  handleCalculator,
  handleAPI,
  handleStatus,
  handleTerms,
  handleSupport,
  handlePaySupport,
  handleHelp,
  setContext
};
