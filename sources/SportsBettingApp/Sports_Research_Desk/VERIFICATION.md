# Verification and audit record

- Baseline recovered package: 11 unit tests passed before edits. No trained model or operational integrations present.
- New candidate: 22 unit/API workflow tests passed. Cases cover odds/EV, payout scenarios, identity, freshness, snapshots, duplicate imports, missing/nonfinite input, combination-leg requirements, no unsupported probabilities, currency/mode separation, provisional exposure, settlement corrections, reconciliation, drawdown, limits, live disconnect/out-of-order updates, HTTP token authentication/user isolation and denied execution, historical leakage rejection and comparable CLV.
- HTTP workflow starts the actual application on an ephemeral loopback port, loads its HTML, rejects bad credentials, creates a paper wager, settles it, reconciles profit and checks another user cannot retrieve it.
- Python compilation and JavaScript syntax checks passed.
- Browser interaction test attempted with the available Playwright runner: BLOCKED because the Chromium executable is absent. No browser/device rendering or click-flow pass is claimed. API behavior is tested separately.
- Existing EdgeBoard Lab production: NOT MODIFIED / NOT VERIFIED. Fresh AppDeploy get_app_status and src_glob for edgeboard-lab-o28tdu each returned Unauthorized. This does not establish that the app is down.
- Providers, quotas, live coverage, automated feed recovery/alerts, account availability and book settlement reconciliation: NOT VERIFIED / UNAVAILABLE.
- Historical model calibration, held-out returns, model improvement and profitability: NOT EVALUATED; no dataset/model provided.
- This is a runnable local research/tracking candidate with explicit missing capabilities, not completion of universal operational coverage or a production security sign-off.
