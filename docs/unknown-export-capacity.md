# Unknown export capacity recovery

The November 4 account audit found a shared contact-enrichment stall after an
admitted owner export timed out. Its local request finished after 120 seconds
with `outcome: unknown`; no provider response, export ID or charge was saved.
The original contacts handler finished in `held_for_reconciliation`. Existing
automatic capacity recovery accepted completed, specific HTTP errors only, so
this unknown result occupied the organization export slot indefinitely.

At the 22:49 UTC baseline, 52 of 53 accounts classified as `no_completed_work`
had current export-capacity waits. Research still had 1,623 ordinary requests
and 980 protected starter requests available. The current worker was running
main `5b3f71252238a19ac3df99d5205b9dae7d1f3236` with no observed resource
pressure or post-start scheduler errors. Restarting it would not resolve the
durable export hold.

There were also 67 `pending_work` accounts with insufficient available credits
after unresolved operations. Those financial holds are a separate problem,
and this change must not mark them settled or promise that all 120 monitored
accounts will resume. One other stalled account had a full opportunity buffer
containing contacts unavailable under cross-account phone claims; that is a
separate correction.

The new recovery family must preserve the original unknown purchase, its
owners, customer financial commitment and missing receipt. It may release only
shared capacity after separately admitted, fresh, complete provider inventories
confirm no pending or processing exports. It must not retry the paid export,
infer zero cost, manufacture a response or change customer controls. Original
late evidence must remain writable and must restore the appropriate capacity
restriction when it reveals nonterminal provider work.

Release verification requires source and receipt regression tests, native
concurrent claims/finalization/late-evidence checks, an exact guarded database
installation, the matching application release, and ordinary production
recovery evidence. The policy is installed disabled. A successful deployment
or an available capacity slot alone is not proof that customer work completed.

## Follow-up audit and local verification

At 02:02:59 UTC on November 5, the monitor reported 57 accounts with no
completed work; 56 had export-capacity waits. The separate pending-work cohort
remained at 67 accounts. The accompanying phone-inventory buffer correction is
documented in `docs/phone-inventory-opportunity-buffer.md`.

All 771 local `.test.mjs` suites passed across the initial run and its
continuation. The initial run exposed an existing UTC/Chicago date mismatch in
the owner-outcomes fixture; that fixture was corrected and passed separately.
TypeScript, the isolated production build, all desktop Chromium scenarios, and
the bounded request-concurrency check passed. The latter exercised 12
simultaneous requests without duplicate sends, duplicate charges or account
mismatches and retained both unknown outcomes.

Native PostgreSQL concurrency tests still require the PostgreSQL 17 CI service.
Mobile WebKit could not launch locally because its operating-system libraries
were missing. Neither that launch failure nor Python syntax checks establish a
passing native concurrency or mobile result. Exact-commit canonical CI,
guarded installation, matching production releases, policy activation and
observed customer progress remain required. No production migration,
activation or release has been performed for this patch.
