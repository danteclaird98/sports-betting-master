# EdgeOdds model-evaluation boundary

This lane audits historical prediction records. It does **not** train, fit,
calibrate, select, or promote a model.

It enforces:
- timezone-aware decision, feature, market-observation, and result timestamps;
- features available no later than decision time;
- market benchmark observed no later than decision time;
- unique records;
- event-disjoint chronological train/validation/test partitions;
- training labels available by the train boundary;
- validation labels available by the validation boundary.

It reports model and market-baseline metrics separately:
- Brier score;
- log loss;
- calibration bins;
- event-cluster bootstrap Brier intervals;
- matched model-minus-market Brier delta;
- model/market missingness;
- abstention rate;
- selected/executable counts;
- closing-quote coverage for CLV-eligible selections.

Every report returns `HELD_OUT_IMPROVEMENT_UNESTABLISHED` and
`promotion_allowed=false`. Predictive promotion requires a separate,
pre-registered model-development process and actual historical evidence.
