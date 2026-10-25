# Usage at scale — October 25, 2026

Four webinar poll handlers now select only session ownership, recording scope,
preview and supersession state. A production read-only measurement found an
average full session representation of 30,480 bytes versus 245 bytes for those
fields. This removes approximately 99% of that lookup payload, not 99% of total
site bandwidth. Authentication and mutable session state are never cached.

Public uploads use new UUID object paths with 30-day browser caching. The owner
studio's Optimize video delivery action copies only its saved public Daytime and
Nighttime files, verifies response type, length and cache headers, and publishes
the new URLs with an optimistic revision check. Originals and active viewer
snapshots remain unchanged. Private course files and externally hosted media
are excluded. First-time viewers still download video bytes; this change reduces
repeat downloads, without altering playback, quality or checkout.

Delivery verification uses `GET` with `Range: bytes=0-0`, checks the full file
length from `Content-Range`, and cancels the response body. Supabase deliberately
returns `no-cache` for `HEAD`, so metadata-only checks cannot verify browser cache
policy: https://github.com/supabase/storage/issues/1290.
An ignored range or unverifiable response stops publication instead of fetching
the full video. The October 25 live check confirmed a one-byte `206` response
with `public, max-age=2592000` for the copied main recording.

The shared DealMachine counter showed 4,500 of 4,500 at 2:07 PM Central on
October 25. Local quota refusals then generated failed research capabilities and
worker backoff. The provider's published default is 60 requests/minute and 5,000
requests/day: https://api.docs.dealmachine.com/rate-limits.

The application now permits 4,900 daily requests, retaining 50/minute and a
100-request daily margin. Counters and their current windows are preserved.
Acquisition requires room for a preview and retrieval before scanning accounts;
the existing atomic per-request admission still enforces the real bound.
Exhausted windows skip research and contact acquisition while leaving texts,
calls, billing and other scheduler branches available. Window expiry reopens
eligibility automatically. This is not a provider-plan upgrade or a reset of
usage; higher sustained request volume requires verified provider entitlement.

Filtered discovery's exact atomic prospecting-budget exception follows the
existing budget-hold path. All ambiguous provider outcomes retain reconciliation
holds. Fixed-code diagnostics include provider stage and HTTP status without
credentials, request/response bodies or customer details.

Validation uses isolated PostgreSQL and mocked provider fixtures. It does not
send live messages, place test calls or consume paid development data credits.
