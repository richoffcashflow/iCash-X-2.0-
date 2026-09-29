# Automatic ZIP research

The existing Railway automation poller now handles `market_research` tickets. Customer work takes priority. Enabled research scopes refresh weekly, discover ZIP codes through DealMachine `/v1/locations`, and screen actual counts through `/v1/properties/search/count` before purchasing any record.

Each ZIP gets total property inventory, single-family inventory with estimated equity at least 70%, and a potential-buyer proxy (corporate owners, no recorded mortgage, purchase within the last year). Neither estimated equity nor the buyer proxy establishes a viable deal or a verified cash buyer.

Controls: at most 50 reserved free metadata requests per UTC day across all accounts; one research ticket per minute; four location pages per scope; three execution attempts per job; one-hour error backoff; fifteen-minute abandoned-job recovery. Reservations are intentionally not refunded on timeout. Jobs deduplicate within each scan. Existing global DealMachine rate limiting also applies. No LLM, enrichment, calls, or texts are used for research. Hosting overhead still exists.

Results remain tenant-scoped research candidates. Inventory score is `ln(1 + high-equity properties) * ln(1 + potential buyers)`: an initial screening heuristic, not learned conversion performance. City-name location search can omit ZIPs or return surrounding areas. It does not certify urban boundaries or legal eligibility. Counts are timestamped; results older than the most recent scan should not be treated as fresh.

Research never writes market eligibility or disables financial/contact safeguards. Existing eligible inventory rotation remains responsible for paid search. Outcome-based allocation exists separately in `market-brain.ts`; this release does not claim that unobserved contracts or closings trained a model. Only the four researched cities are seeded initially; adding new research scopes is an internal operation with no customer setup screens.

Migration: `config/market-expansion.sql`. Scope activation is separate from migration. Rollback-safe SQL tests exercise tenant isolation, duplicate claims/results, state validation, request limits, and public-access denial. TypeScript tests validate filter construction and reject malformed provider responses.
