# Supabase efficiency

The October 6, 2026 production investigation found repeated enumeration of
`pg_timezone_names` in reports, scheduler wrappers, and contact-time checks.
PostgreSQL reads the complete timezone catalog for these lookups: an equality
lookup took 647 ms on the existing Nano database. Historical query statistics
also showed repeated scans of completed automation tickets.

`20261006183531_indexed_timezone_catalog_and_automation_queue.sql` adds:

- A private, indexed copy of valid timezone **names**. PostgreSQL still calculates
  offsets and daylight-saving transitions from its current tzdata.
- Indexes for ticket kind/recent time, issued-ticket expiry, and per-message
  opener history. Completed history remains intact.
- A narrow replacement of the timezone lookup relation in the 14 currently
  installed private functions. Their bodies otherwise match the previous
  versions, including grants, security mode, volatility, and search path.

The same production activity-report query measured 568 ms before and 41 ms after
the migration, before any compute upgrade. These are database execution samples,
not an end-to-end latency guarantee or an estimate of maximum user capacity.

## After a PostgreSQL or tzdata upgrade

Refresh the name catalog as its database owner:

```sql
select public.icash_refresh_timezone_names();
```

The refresh is atomic. Anonymous, authenticated, and service-role API callers
cannot invoke it; service-role application queries can only read the catalog.
Do not cache offsets or replace `AT TIME ZONE` calculations.

New application SQL should use `public.icash_timezone_names` when validating or
joining a timezone name. Keep all account, contact, budget, and local-time checks.

## Verification

Use an installed official PGlite module, currently tested with 0.5.8:

```bash
node scripts/test-supabase-efficiency-pglite.mjs /absolute/path/to/pglite/dist/index.js
node scripts/test-activity-report-pglite.mjs /absolute/path/to/pglite/dist/index.js config/supabase-efficiency.sql
```

The tests cover catalog equality, invalid-name rejection, DST boundaries, private
grants, owner-only refresh, exact function preservation, activity deduplication,
calendar windows, and account isolation. Production checks additionally compared
normalized function hashes and confirmed zero differences in valid timezone names.
