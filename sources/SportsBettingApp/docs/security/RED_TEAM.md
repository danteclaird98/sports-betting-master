# EdgeOdds reliability/security red-team gate

This suite attacks cross-layer failure modes rather than adding product features.

Current adversarial coverage includes:
- fresh retrieval of stale provider quotes;
- future provider clocks;
- suspended outlier prices;
- settlement-rule mismatch;
- alternate spread/total threshold mismatch;
- missing and post-start closing quote clocks;
- conflicting same-time price histories;
- unverified/unknown settlement semantics;
- cross-book semantic equivalence with distinct provenance.

A passing red-team suite is correctness evidence only. It is not live-provider
verification and does not establish predictive profitability.
