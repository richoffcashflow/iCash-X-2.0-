# Wholesale deal scenarios and executable next steps

The owner's November 12 request is a researched comparison of 2,000 text, call, contract, buyer, showing, inspection, title and payment scenarios against iCash X. Routine questions should progress automatically. A generic review label is not a recovery action.

## Scope and evidence

`scripts/build-wholesale-scenarios.py` contains 400 authored situations in 40 categories. Each has five branches: current evidence, missing evidence, a newer conflicting event, an uncertain original execution and an overdue checkpoint. It emits 2,000 stable IDs with the event, AI action, required evidence, UI surface/status, next step, authority, deadline policy, current subsystem and gap ID. These are synthetic design and acceptance requirements, not 2,000 executed tests or verified production outcomes.

`coverage.json` records 16 gap areas against main `5bbf8c69ff912c53b3e88561a375c54987161c93`, with current code paths and eight research sources. A source informs the issue class; it does not establish the frequency of a scenario in iCash. A code-path mapping is not proof that the existing subsystem handles every assigned case. Jurisdiction-specific statements are not nationwide rules.

Generate the portable report:

```sh
python3 scripts/build-wholesale-scenarios.py
python3 scripts/render-wholesale-scenarios.py /tmp/iCash-X-2000-Scenarios.html
```

The HTML includes search, category/branch filters, pagination, current-vs-proposed comparison, six deal playthroughs, research notes and a complete JSON download. It needs no network to work. The generated JSON is ignored because its complete source is the authored generator.

## Focused repairs in this change

1. **Combined package requests:** the original live classifier returned null for “Send photos and property details.” The reviewed replacement recognizes only an entire request containing two to five package-information items. Actual SQL fixtures follow the source-bound reply job through one existing authorized package dispatch and receipt. Conditional price changes, access, signing, refunds, wire instructions and opt-outs do not become package-only requests.
2. **Active visit progress:** a proposed or confirmed visit no longer becomes generic owner review solely because `last_progress_at` is older than three days. Existing signature, assignment and reservation priorities remain.
3. **No invented viewing options:** the UI says options are available only when the buyer wants a viewing and saved slots exist. Otherwise it shows the existing buyer-choice step. No layout or controls change.
4. **Negated title evidence:** straight and curly-apostrophe contractions such as “wasn't received” cannot create a positive title milestone suggestion. The original parser only suggested statuses; it did not directly settle deposits or proceeds.

## Next implementation order

1. Add a source-bound adapter from completed inbound buyer calls to the existing package, signer-detail and viewing handlers. Outbound buyer contact remains SMS/email. Never claim an action occurred from the conversation alone.
2. Extract supported nonbinding requests from verified title replies into specific document or evidence tasks. Milestones require the existing authoritative confirmation process.
3. Resolve ordinary factual buyer blockers automatically; define approved commercial bounds separately for price, fee, timing and deposit changes. Preserve signatures and exact accepted terms.
4. Add inspection scheduling, access/utility confirmation, report collection and deadline handling as executable tasks. Price changes use new verified facts and the necessary party's acceptance.
5. Extend the existing supervisor with these handlers. Reuse source revision, final admission, original operation receipts and per-deal backoff rather than creating a second engine.

Every unresolved dependency needs: `deal_id`, source identity/revision, a specific reason, next permitted action, responsible party, required evidence, contractual deadline, next check, and original operation/receipt identity. Independent eligible tasks continue while that dependency waits. Internal checks are not permission to send a reminder every five minutes.

The existing UI should render the real next action: “Waiting for seller availability,” “Requesting payoff statement,” or “Checking original deposit confirmation.” Only a specific signature, disputed term, legal determination or requested human conversation should ask a person for a decision. Queued is not sent; proposed is not confirmed; signed is not funded; title-reported disbursement is not received proceeds.

## Validation and release

Focused suites cover seller text SQL and dispatch recovery, title reply suggestions, workspace next actions, deal journey service, closing completion and supervisor behavior. TypeScript and the production build pass locally. Canonical release and fixture browser results are recorded on the release PR; the catalog itself is not a test result.

The database change is the pure `icash_buyer_request_action(text)` classifier only. Its migration checks the exact predecessor source hash, preserves private ACLs and does not update historical sources, settings, jobs, operations, controls or funds. Existing source-age/cutover, package authority, contact, current-price and final-send gates remain. Do not replay old review messages to exercise the expanded classifier. Install only the reviewed migration and verify the receipt; a successful web build does not prove SQL installation.

Use the existing exact-head CI, normal merge, exact-main CI and production deployment verification path. Do not claim the broader proposed workflows or all 2,000 cases are live. No paid-provider tests or customer outreach are part of this work.
