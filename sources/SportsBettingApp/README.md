# Sports betting research improvement candidate

Status: standalone candidate, not integrated or deployed. No existing agent source, trained model, prediction ledger, or historical odds dataset was located. No model was changed. No held-out improvement claim is justified. Tests use synthetic fixtures solely to validate arithmetic and controls.

## Baseline before model changes
Freeze original source/model/configuration, dataset hashes, feature definitions, prediction times and settlement rules. Archive original predictions; do not reconstruct them from the conversation. The supplied conversation lacks synchronized two-sided prices, validated probability forecasts and complete outcomes. Consequently calibration, Brier/log loss, CLV, returns and sport/market/season performance are all NOT MEASURED.

## Implemented
research.py provides timezone-aware chronological partitions with event overlap and settlement-label boundary checks; rejects future feature availability or model training cutoffs; binary Brier/log loss and reliability bins; proportional two-way de-vig; quote/source/identity/rule validation gates; uncertainty-bound EV abstention; explicit prohibition on unsupported parlay probability multiplication; limit/rejection-aware settlement arithmetic; exact-market CLV matching; required research result fields. Twelve regression tests pass.

Validation flags must come from trusted adapters, not the language model. The module does not itself verify events against a schedule or authenticate a source. Freshness default 120 seconds and EV buffer 2% are provisional configuration values, not evidence-based optimized thresholds. No calibration model or uncertainty estimator has been fitted. Unsupported push/void probability markets abstain even though realized push/void settlements can be logged.

## Required historical data
One frozen prediction per decision, with prediction ID, event ID, sport, season, scheduled start and actual start, player/team IDs, market statistic, period, side, line, overtime rules and settlement version. Include bookmaker and source URL/ID, decimal odds, opposing price, quote time, ingestion time, decision time, every feature's first observed availability time and value version, model training cutoff and version, probability, eventual outcome and settlement time. Feature availability must use the latest availability across all input features, including revised injuries/lineups. Keep closing prices separate from prediction inputs.

Execution ledger: attempt time, decision delay, requested stake, limit known at that time, accepted stake and odds, rejection/unavailable reason, fees, payout, settlement revisions. Preserve rejected attempts and missing quotes. Do not use advertised prices as if accepted.

## Chronological evaluation protocol
Choose exact train/validation/test date boundaries from available complete seasons before analysis. Keep every prediction from an event in a single partition; purge crossing events and labels not settled by the next partition. Train the original model using training data only. Fit a sigmoid calibration candidate on an early validation block and select identity versus calibrated candidate on a later validation block. Freeze all thresholds, freshness policies and calibrator before opening test labels. Add an untouched later season or forward shadow period for confirmation; inspecting a test period makes it unavailable for later tuning.

Compare original, constant .5, training-only sport/market base rate, and decision-time de-vigged market probability on the same eligible outcomes. Keep original full-cohort results and exclusion counts so filters cannot create an apparent improvement by dropping difficult cases. Separate binary win/loss probability scoring from push/void/partial settlement markets until their outcome models are implemented.

Report paired Brier and log-loss differences, fixed reliability bins with sample counts, ECE as a secondary diagnostic, and coverage/abstention. Lower Brier alone does not establish better calibration. Add event-cluster bootstrap intervals for paired differences and returns; use date/week block resampling for temporal dependence and disclose sensitivity. Report per sport, exact market family and season: eligible decisions, unique events, accepted bets, settled bets, fill rate, scores, calibration, CLV coverage, turnover, profit and ROI with intervals. Sparse groups remain inconclusive; do not select a winner from profit alone or repeatedly test slices without correction.

## CLV method
Select a named reference bookmaker and a fixed closing cutoff before actual event start; use its last fresh, complete two-way pregame quote before that cutoff, with no later quote substituted. For the same event, side, line, period and settlement rules, calculate p_close=(1/d_close_side)/sum(1/d_close_outcomes), then price CLV=d_accepted*p_close-1. Positive means accepted price exceeds the reference fair closing price. Closing probability is a benchmark, not ground truth. Missing exact lines yield unavailable CLV. Track spread/total line movement separately in points; never treat different lines as equal contracts. Do not label a pre-close snapshot closing-line value.

## Realistic returns
Replay the first eligible quote at or after decision time plus a predetermined delay, before a short expiration timeout. Do not cherry-pick a later favorable quote. Require accepted execution evidence, or label all returns simulated. Honor stakes/limits, price changes, rejection, bookmaker access and settlement rules. Report attempted and filled turnover, net return/filled turnover, maximum drawdown and exposure concentration. Run delay/limit/missing-price sensitivity scenarios fixed before test evaluation. Promotions require actual eligibility, profit-only versus total-return multiplier terms, stake caps, rollover and void rules. General push-aware unit EV is p_win*(decimal-1)-p_loss; binary p*decimal-1 is insufficient if pushes exist.

## Review of supplied conversation
A lower alternate line is not proof of positive EV without its price and an outcome distribution. One-sided -135 pricing cannot establish fair probability without the other side. Different games do not guarantee independence, and same-game slips require a joint probability model or abstention. Cashout decisions require current conditional payout value; sunk stakes alone do not support holding. Historical recommendations and injury assertions are unverified context, not a measurement baseline.

## Every research result
Return event/market identity, sportsbook, timestamped odds, raw implied probability (label the vig), matched de-vigged comparator where available, model estimate/version, uncertainty interval/method and validation status, EV at the offered price, sources with observation times, status and concrete reasons to abstain. Unknown fields stay null/unavailable; never invent probabilities. Explain why the lower uncertainty bound does or does not clear a frozen research threshold. A research pass does not execute a wager.

## Remaining work
Connect the actual agent and historical data; implement authenticated source and schedule adapters, point-in-time joins, quote replay, fitted calibration, validated uncertainty, cluster/block bootstrap reporting and a persistent prediction ledger. These are prerequisites to a real held-out comparison. This package deliberately does not fabricate a benchmark or automatically promote its candidate controls as profitable.

Run: python3 -m unittest discover -s betting_research -v
Reference: https://scikit-learn.org/stable/modules/calibration.html
