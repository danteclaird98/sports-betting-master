export function caesarsRuleReferences() {
  return {
    status: 'JURISDICTION_SCOPED_REFERENCES_ONLY', verifiedTicketContracts: 0,
    warning: 'Caesars terms vary by jurisdiction and date. No rule below is automatically applied to any ticket. Confirm account jurisdiction, in-app rule edition, market, bet type and promotion.',
    rules: [
      { jurisdiction: 'Oregon, Ko-Kwel tribal retail rulebook', effective: '2026-02-03',
        subject: 'Same-game parlay push/void', description: 'Published rules state remaining valid SGP legs are repriced when a leg pushes or voids.',
        source: 'https://www.kokwelresorts.com/wp-content/uploads/2026/02/2602-Caesars-Sportsbook-Rule-Book-Web.pdf',
        appliesAutomatically: false, ticketContractVerified: false },
      { jurisdiction: 'Massachusetts, regulator current licensee rulebook index', effective: 'Listed current since 2026-08-03; full terms not reviewed in this app',
        subject: 'Official current rules reference', description: 'Massachusetts Gaming Commission lists an effective Caesars rulebook and archived prior versions. Exact SGP terms must be read from the linked active rulebook.',
        source: 'https://massgaming.com/about/sports-wagering-in-massachusetts/sports-wagering-licensees/caesars-sportsbook/',
        appliesAutomatically: false, ticketContractVerified: false },
      { jurisdiction: 'Maryland, Horseshoe Baltimore retail house rules', effective: 'Filing 2021-10-01 (current status unverified)',
        subject: 'Same-game parlay void', description: 'Published reference describes whole-bet void handling with an exception; retail-only and stale until independently verified.',
        source: 'https://www.caesars.com/content/dam/uba/caesarssportsbook/caesarssportsbook_marylandretailrulespart1.pdf',
        appliesAutomatically: false, ticketContractVerified: false },
    ],
    requiredForLiveUse: ['Account state and specific sportsbook', 'Official latest applicable house-rule version',
      'Sport, market, full game versus partial period, overtime and participation clauses',
      'SGP void/reprice convention and promotional terms', 'Repriced accepted payout from Caesars when relevant'],
  };
}
