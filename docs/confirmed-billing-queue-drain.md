# Confirmed billing queue drain

On November 4, production had 60 already-settled calls waiting ahead of unfinished receipt recovery. The once-per-minute worker spent its sole claim on each confirmed entry. Normal calls were billed, but old incomplete calls waited behind unnecessary bookkeeping.

The claim now checks at most 100 oldest-due pending entries using the existing full settlement readback. It marks an entry completed only after matching the exact operation, finished call, rate/party, all 16 cost components, original credit reservation, manifest and actual ledger debit (or the existing explicit zero-charge/released-reservation rule). This changes queue state only. It does not settle an operation, alter a wallet, infer a provider charge or call a provider.

The bounded scan precedes the receipt checks. Locked rows are skipped. Active and expired leases retain their existing handling, and explicit reviews are never cleared. Unfinished provider work still gets at most one original 120-second lease per invocation, with unchanged retry limits, backoff and canonical account/call binding.

The migration requires the exact original claim definition and preserves its security-definer, empty search path and ACL. Offline tests reproduce the starvation, preserve every financial/source row, reject incomplete and cross-account evidence, check the 100-row ceiling and protected roles. Native PostgreSQL CI exercises competing workers and an independently locked queue row. No paid test is used.
