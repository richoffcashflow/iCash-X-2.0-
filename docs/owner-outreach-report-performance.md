# Admin outreach report performance

The November 5 admin overview reached the owner dashboard but its outreach RPC
exceeded the existing eight-second database deadline. It repeatedly classified
historical transcripts while reading approximately 48,000 properties and 17,000
voice jobs.

The ordered migrations `20261105060804_owner_outreach_report_performance` and
`20261105061150_owner_outreach_response_fence` are applied in production. They:

- Deduplicate bound conversation projections before classifying them.
- Reuse response/disposition results instead of repeatedly calling nested helpers.
- Evaluate the inexpensive human-response branch first, preserving the original
  source-word opt-out fallback for automated/empty responses.
- Skip full disposition scans for completed calls proven to have no response.
  Source-word opt-outs always satisfy the response predicate; incomplete calls
  still receive the original disposition check.

No source receipts, customer records, billing, worker controls, report periods,
filters, totals, pagination or permissions change. The functions retain
their original security-invoker privileges and read-only report behavior.

Validation compares the original and optimized complete report JSON on the same
database clock across periods, filters, pagination, owner/test boundaries, old SMS
interest, voicemail, opt-out, incomplete/NULL states and multiple projections.
The reordered response predicate matched all 2,921 production conversations in a
read-only comparison. The optimized service-role RPC result passed the application response validator.
The full REST request measured 6–10 seconds under live load, so
`20261105062111_owner_outreach_report_deadline` sets a 12-second budget on this
owner-only function, below the existing 15-second application request limit.
PostgREST hoists this function setting into the request transaction; a schema
reload refreshes its metadata. The authenticator, worker and global timeouts are
unchanged. A function-call profile confirmed the RPC runs once per REST request.

Rollback requires a reviewed forward migration reversing the guarded replacements
in reverse order, using the exact old/new fragments in the config SQL files.
Reset the report-specific timeout with `ALTER FUNCTION ... RESET statement_timeout`
and notify PostgREST to reload its schema.
Do not change historical receipts or increase the global timeout as a rollback.
