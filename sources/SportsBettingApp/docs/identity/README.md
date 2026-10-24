# Event identity hardening

This change extends the canonical-event evidence boundary with optional venue and
neutral-site metadata.

Rules:
- provider-supplied venue evidence must match canonical venue evidence;
- provider-supplied neutral-site state must match canonical state;
- absent evidence is not invented;
- if multiple otherwise-valid events remain, resolution stays ambiguous;
- material reschedules outside the configured time tolerance remain unresolved.

This is a protected `canonical-event` contract change and requires orchestrator review.
