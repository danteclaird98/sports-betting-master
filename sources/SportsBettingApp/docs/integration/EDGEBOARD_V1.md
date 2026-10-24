# EdgeBoard v1 compatibility contract

Endpoint: `GET /v1/edgeboard?event_id=...&mode=...`

Schema: `edgeodds.edgeboard.v1`

The contract is read-only and provider-independent. EdgeBoard receives stable
generic fields for:
- event identity;
- market family/selection/line/period/settlement rule verification;
- sportsbook and decimal price;
- quote/feed/retrieval timestamps;
- provider/source IDs and raw evidence hash;
- analysis eligibility, qualification, probabilities, EV, uncertainty, CLV,
  and reasons to abstain.

Provider-native payload structure is intentionally excluded. External market/
outcome fields and vendor-specific nesting do not become part of EdgeBoard's
public contract.

Missing evidence stays missing:
- unavailable quote-update time remains `null`;
- unverified settlement rules remain false;
- unavailable model probability/EV remain `null`;
- live verification remains false until separately proven.

The endpoint exposes no write or wagering action.
