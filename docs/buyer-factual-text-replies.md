# Bounded buyer factual SMS replies

This separate patch adds deterministic automatic SMS answers to narrowly recognized buyer questions, using the current approved package. The model still outputs review for buyers and cannot choose the reply body, price, URL, recipient or authority. The worker supplies only its account and existing incoming-message job ID to a server-only queue function.

Supported whole-message questions cover buyer asking price, assignment fee, repair estimate, estimated ARV, closing costs, package closing date, what assignment means, and the existing deal-summary link. Prices come from the approved package; assignment fee is already included. Estimates are labeled. Closing dates are not claimed to be scheduled. The package reply only uses an existing active link. It cannot invent photos, comps or any missing value.

Mixed questions, negotiation, showing/access requests, deposits, funds, title/legal issues, unsupported wording, missing package data, missing estimates, or stale closing dates remain on the existing review path. Human/callback requests, STOP and refusal prevent this queue. Email behavior is unchanged: the separately gated workflow can fulfill an explicit buyer email-package request; this is not automatic email conversation support.

The SQL queue repeats account/thread/job binding, auto mode, pause/manual/retirement, suppression, SMS permission review, latest received-message and frequency checks. It deduplicates by the job's existing outgoing ID and avoids repeating an identical outgoing answer. Existing text queue/dispatch functions remain responsible for recipient consent, current rates, quiet hours, business number, spend reservation and final claim. A new outer claim wrapper regenerates the factual body from the current package and source message: changed terms, revoked package, new incoming text or altered outgoing content stop dispatch. It calls the previous claim chain unchanged.

## Integration

1. Reviewed the new `config/buyer-factual-text-replies.sql` against the current deployed wrapper chain and existing buyer package/SMS review functions. The initial production definition read was cancelled. After explicit user approval, the exact read succeeded; two additional narrowly scoped non-protected wrapper reads confirmed the campaign blockers. The applied guarded replacements permit only the signed-deal factual buyer lane, preserving seller restrictions.
2. SQL migration buyer_factual_text_replies was applied and verified on October 7, 2026 at about 20:02 UTC. Do not apply it again. It renames the current `icash_claim_text` once and is intentionally not rerunnable. No authorization rows, recipient lists, rates or provider credentials are created or changed.
3. Deploy source separately from the earlier tested launch release. No live contact was made in development.
4. Verify private buyer-thread behavior with an authorized fixture before allowing real contact. Missing migration fails closed through the existing service error handling; do not retry a consumed AI request automatically.

Prerequisites remain a real signed purchase, current matching disposition/package, owned buyer thread, valid channel-specific permissions, active sender/rates, unpaused automatic mode, current operating checks, balance and quiet hours. Do not fabricate any prerequisite or claim all buyer emails now receive automatic replies.

## Local verification

- `tests/text-ai-service-trust.test.mjs`: fake database and provider; buyer server queue only, no model prose, seller behavior preserved, STOP/refusal/human/callback blockers.
- `tests/text-ai.test.mjs`: existing bounded model-output checks.
- `scripts/test-buyer-factual-text-pglite.mjs <local pglite module>`: actual new SQL compiled/executed against local fixture tables and stubbed permission/package/dispatch delegates; factual templates, unsupported/mixed content, tenant isolation, current-data revalidation, replay, daily cap and denied client roles. The existing production spend/consent chain is preserved, not reimplemented in these fixtures. Single-process PGlite is not proof of PostgreSQL lock contention.

Post-apply verification confirmed the two edited legacy function definitions are byte-identical outside the guarded replacements (normalized MD5 matches), and the existing save/queue/payment-policy delegate definitions have unchanged hashes. New routines are security-invoker, service-only, unavailable to anon/authenticated. Missing-scope factual reads return null. There were zero buyer threads; no outgoing messages or recipients were created. Lock order is operating budget, recipient advisory lock, then thread/deal checks, matching the source incoming STOP ordering. Local testing covers 31 scenarios; real concurrent PostgreSQL execution is not claimed.
