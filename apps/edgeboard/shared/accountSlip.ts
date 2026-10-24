export const MARKET_LABELS: Record<string, string> = {
  points: 'Points',
  rush_rec_tds: 'Rushing + Receiving Touchdowns',
  rebounds: 'Rebounds',
  assists: 'Assists',
  pts_rebs: 'Points + Rebounds',
  pts_asts: 'Points + Assists',
  rebs_asts: 'Rebounds + Assists',
  pts_rebs_asts: 'Points + Rebounds + Assists',
  three_points_made: '3-Pointers Made',
  shots: 'Shots on Goal',
  receptions: 'Receptions',
  receiving_yards: 'Receiving Yards',
  rushing_yards: 'Rushing Yards',
  passing_yards: 'Passing Yards',
  passing_completions: 'Passing Completions',
  passing_attempts: 'Passing Attempts',
  passing_interceptions: 'Passing Interceptions',
  fantasy_points: 'Fantasy Points',
  goals: 'Goals',
  hits: 'Hits',
  strikeouts: 'Strikeouts',
  saves: 'Saves',
  blocks: 'Blocks',
  steals: 'Steals',
};

export function identity(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function marketKey(value: string): string | null {
  const normalized = identity(value).replace(/[_-]/g, ' ').replace(/\s+/g, ' ');
  for (const [key, label] of Object.entries(MARKET_LABELS)) {
    if (
      normalized === identity(key).replace(/_/g, ' ') ||
      normalized === identity(label)
    )
      return key;
  }
  return null;
}

export type SlipContract = {
  sport: string;
  event: string;
  player: string;
  market: string;
  line: number;
  side: 'Higher' | 'Lower';
  period: 'FULL_GAME' | '1H' | '2H' | 'UNKNOWN';
};

export type AccountLeg = SlipContract & {
  accountConfirmed: boolean;
  reference?: SlipContract;
};

export function contractDifferences(
  account: SlipContract,
  reference: SlipContract,
) {
  const fields = ['sport', 'event', 'player', 'side', 'period'] as const;
  const differences: string[] = fields.filter(
    (field) => identity(account[field]) !== identity(reference[field]),
  );
  if (
    marketKey(account.market) !== marketKey(reference.market) ||
    !marketKey(account.market)
  )
    differences.push('market');
  if (account.line !== reference.line) differences.push('line');
  return differences;
}

function numberInput(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
  optional = false,
) {
  if (
    (typeof value === 'string' && !value.trim()) ||
    value === null ||
    value === undefined
  ) {
    if (optional) return null;
    throw new Error(`${label} is required.`);
  }
  if (typeof value !== 'number' && typeof value !== 'string')
    throw new Error(`${label} must be a number.`);
  const result = Number(value);
  if (!Number.isFinite(result) || result < minimum || result > maximum)
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  return result;
}

export function readAccountLegs(input: unknown): AccountLeg[] {
  if (!Array.isArray(input) || input.length < 2 || input.length > 4)
    throw new Error('Enter two to four exact account selections.');
  function readContract(value: unknown): SlipContract {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Invalid selection.');
    const row = value as Record<string, unknown>;
    for (const key of ['sport', 'event', 'player', 'market']) {
      if (
        typeof row[key] !== 'string' ||
        !String(row[key]).trim() ||
        String(row[key]).length > 200
      )
        throw new Error(`Each selection needs a valid ${key}.`);
    }
    const market = marketKey(String(row.market));
    if (!market)
      throw new Error(
        'Choose an exact supported market; Points + Rebounds and Points + Rebounds + Assists are different.',
      );
    if (row.side !== 'Higher' && row.side !== 'Lower')
      throw new Error('Choose Higher or Lower for each selection.');
    if (!['FULL_GAME', '1H', '2H', 'UNKNOWN'].includes(String(row.period)))
      throw new Error('Choose the selection period.');
    return {
      sport: String(row.sport).trim(),
      event: String(row.event).trim(),
      player: String(row.player).trim(),
      market,
      line: numberInput(row.line, 'Line', 0, 100000)!,
      side: row.side,
      period: row.period as SlipContract['period'],
    };
  }
  return input.map((value) => {
    const row = value as Record<string, unknown>;
    const contract = readContract(value);
    return {
      ...contract,
      accountConfirmed: row.accountConfirmed === true,
      ...(row.reference ? { reference: readContract(row.reference) } : {}),
    };
  });
}

export function payoutCheck(
  input: unknown,
  legCount: number,
  now = Date.now(),
) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Enter your combined payout.');
  const row = input as Record<string, unknown>;
  const base = numberInput(
    row.baseDecimal,
    'Unboosted combined return',
    1.000001,
    1000000,
  )!;
  const percent = numberInput(row.boostPercent, 'Boost percentage', 0, 200)!;
  const kind = row.boostKind;
  if (kind !== 'profit' && kind !== 'return')
    throw new Error('Choose profit boost or total-return boost.');
  const credit = row.extraFunds;
  if (credit !== 'bonus' && credit !== 'cash')
    throw new Error('Choose how the extra winnings are paid.');
  const bonusValue = numberInput(
    row.bonusValue,
    'Bonus cash-value assumption',
    0,
    1,
  )!;
  const displayed = numberInput(
    row.displayedBoostedDecimal,
    'Displayed boosted combined return',
    1.000001,
    1000000,
    true,
  );
  const theoretical =
    kind === 'profit'
      ? base + ((base - 1) * percent) / 100
      : base * (1 + percent / 100);
  const observed = displayed ?? theoretical;
  const issues: string[] = [];
  // Both displayed returns may have been rounded to two decimal places.
  const roundingTolerance = 0.005 * (1 + percent / 100) + 0.005 + 1e-8;
  if (
    displayed !== null &&
    Math.abs(displayed - theoretical) > roundingTolerance
  )
    issues.push(
      'Displayed payout does not match the entered boost terms, allowing for two-decimal rounding. Recheck both returns and the offer.',
    );
  if (observed < base)
    throw new Error('Boosted return cannot be below the unboosted return.');
  const cashReturn = credit === 'cash' ? observed : base;
  const bonusReturn = credit === 'bonus' ? observed - base : 0;
  const effectiveReturn = cashReturn + bonusReturn * bonusValue;
  const allOrNothing = row.allOrNothingConfirmed === true;
  if (!allOrNothing)
    issues.push(
      'All-win/all-loss payout rules are unconfirmed; flex, partial wins, pushes and voids need a settlement-specific calculation.',
    );
  if (row.payoutIsMaximum === true)
    issues.push(
      'The displayed return is a maximum. Thresholds below are optimistic requirements, not the actual settlement-weighted break-even.',
    );
  if (percent > 0 && row.rulesConfirmed !== true)
    issues.push(
      'Boost eligibility and bonus playthrough/expiry rules are not confirmed.',
    );
  const minLegs = numberInput(
    row.minLegs,
    'Promotion minimum selections',
    1,
    20,
    true,
  );
  const maxStake = numberInput(
    row.maxStake,
    'Promotion maximum stake',
    0.01,
    1000000,
    true,
  );
  const expiresAt =
    typeof row.expiresAt === 'string' && row.expiresAt
      ? Date.parse(row.expiresAt)
      : NaN;
  if (percent > 0) {
    if (minLegs === null || maxStake === null || !Number.isFinite(expiresAt))
      issues.push(
        'Promotion minimum selections, stake limit and timezone-aware expiry are required to verify eligibility.',
      );
    if (minLegs !== null && (!Number.isInteger(minLegs) || legCount < minLegs))
      issues.push(
        'The slip does not meet a valid promotion minimum selection count.',
      );
    if (
      Number.isFinite(expiresAt) &&
      (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(String(row.expiresAt)) ||
        expiresAt <= now)
    )
      issues.push('Promotion expiry is past or lacks a timezone.');
  }
  const bankroll = numberInput(
    row.bankroll,
    'Current bankroll',
    0,
    100000000,
    true,
  );
  const stake = numberInput(row.stake, 'Requested stake', 0, 10000000, true);
  const daily = numberInput(
    row.dailyExposure,
    'Current daily exposure',
    0,
    10000000,
    true,
  );
  const game = numberInput(
    row.gameExposure,
    'Largest current exposure to a game on this slip',
    0,
    10000000,
    true,
  );
  const cap =
    bankroll === null || daily === null || game === null
      ? null
      : Math.max(
          0,
          Math.min(
            bankroll * 0.005,
            bankroll * 0.05 - daily,
            bankroll * 0.03 - game,
            percent > 0 ? (maxStake ?? 0) : Infinity,
          ),
        );
  if (cap === null)
    issues.push(
      'Current bankroll and both exposure amounts are missing; missing exposure is not zero.',
    );
  if (stake !== null && cap !== null && stake > cap + 1e-9)
    issues.push(
      'Requested stake exceeds the 0.5% parlay, 3% game, 5% daily or promotion limit.',
    );
  return {
    baseDecimal: base,
    theoreticalBoostedDecimal: theoretical,
    displayedBoostedDecimal: displayed,
    usedTotalReturn: observed,
    cashReturnPerUnit: cashReturn,
    bonusReturnPerUnit: bonusReturn,
    bonusCashValueAssumption: bonusValue,
    effectiveReturnPerUnit: effectiveReturn,
    thresholdBasis:
      row.payoutIsMaximum === true
        ? 'MAXIMUM_RETURN_OPTIMISTIC_ONLY'
        : allOrNothing
          ? 'USER_CONFIRMED_BINARY_PAYOUT'
          : 'BINARY_SCENARIO_ONLY',
    breakEvenProbability: 1 / effectiveReturn,
    requiredJointProbabilityForThreePercentEv: 1.03 / effectiveReturn,
    faceValueBreakEvenProbability: 1 / observed,
    bankroll,
    requestedStake: stake,
    maxParlayCapBeforeModelApproval: cap,
    issues,
  };
}
