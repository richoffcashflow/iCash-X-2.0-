# Provisional call-usage disclosure candidate

Disabled draft, not activated. Depends on the disabled live metering
candidate. It does not resolve the missing enforceable inclusive provider cost
bound or authorize live activation.

## Exact accounting semantics

- Incremental debit: `icash_credit_ledger.kind = 'usage'`, negative
  `delta_cents`, and `event_key = 'usage-meter:' + operation_key + ':' +
  elapsed_seconds`. A real private meter entry binds that immutable ledger row
  to its meter. The debit has already reduced the wallet.
- Meter states `active`, `stopping`, and `terminal` remain provisional. A call
  ending does not prove that its final provider bill is available.
- Final reconciliation uses the original complete-cost path and changes the
  wallet only by the difference. A further debit has `kind = 'usage'` and
  `event_key = 'usage:' + operation_key`; a credit has `kind = 'grant'` and
  `event_key = 'usage-meter-adjustment:' + operation_key`. Neither is a new
  pricing rule. Zero difference needs no extra ledger entry.
- Settled meters retain their original provisional ledger history, but no
  longer trigger the pending disclosure. Old ledger names alone never suffice.

## Minimal customer path

The customer workspace has no ledger-history screen. Its wallet is rendered by
`BotRunBar`, with account data already loaded by `icash_load_workspace_account`
and passed through `/api/account`. The candidate disclosure SQL enriches that
existing server-only snapshot with `provisionalVoiceUsage: true` only when the
account has an unsettled meter and a matching actual debit ledger entry. It adds
no field for other accounts or payment test mode. There is no extra API request.
Its wrapper calls the original loader unchanged first and derives account
identity only from that authorized response. A disclosure query failure fails
the existing account request rather than silently marking usage final.

Render `ProvisionalVoiceUsageDisclosure` immediately after `BotRunBar`, passing
the snapshot signal and the existing account-error state. It is monochrome,
noninteractive, and absent when data is stale or no pending usage is confirmed.
No public pricing page, funding agreement, or existing unmetered text changes.

Copy:

> Some call usage is awaiting final receipts. Provisional deductions are estimates,
> not final charges. The final amount uses the call’s original rates; only the
> difference is deducted or returned.

The signal intentionally carries no amount: the legacy wallet read and later
meter query can observe different instants during concurrent usage. The existing
30-second account refresh updates this explanatory notice; it is not a real-time
receipt or a new billing control. It remains visible for unresolved deductions
even if metering is later disabled.

## Verification and release boundary

Run the focused display and database disclosure tests, then existing account
route, workspace and aggregate checks after integration. UI rendering and
mobile/desktop layout must be checked before production release or activation. Applying the candidate
SQL would be a separate authorized production action; this file is not an
applied migration. Install after `config/live-voice-metering.sql` and before any
future activation. Keep the worker/server readiness flags and private settings
disabled. Existing pricing, final receipts and ledger mutation functions are
not changed by this disclosure.

Focused local commands:

```sh
node --experimental-strip-types tests/provisional-voice-usage-disclosure.test.mjs
node --experimental-strip-types tests/provisional-voice-usage-disclosure-database.test.mjs
node --experimental-strip-types tests/provisional-voice-usage-disclosure-browser.mjs
```

The first test renders the real component on the server, including pending,
unmetered, final-only and stale states. The separate browser fixture uses local
synthetic markup and CSS only, aborts all network requests, and checks 1280-pixel
and 390-pixel widths. It is not a full workspace end-to-end test. Chromium launch
was blocked by this executor's process-socket restriction; an escalated launch
also failed before execution. Therefore no visual, mobile-overflow or screenshot
pass is claimed here.
