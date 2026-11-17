# Bounded Meta cost report reading

The existing Meta cost reader checked its 500,000-character cap only after
`response.text()` consumed the whole response. A native-stream regression
reproduces the predecessor consuming all 2,000,000 bytes of an oversized report
before rejection. An oversized stream that stayed open could delay the original
cost claim until the transport timeout.

The reader now applies that same character cap as UTF-8 chunks arrive. Streaming
decoding preserves split code points, the original BOM behavior and the accepted
maximum payload; the cap does not silently become a smaller byte limit. Once the
read succeeds or fails, cancellation starts once without waiting for transport
cleanup. Rejected cleanup is observed and the reader lock is released.

The change keeps the original GET-only requests, ten-second fetch signal,
pagination limits, campaign/account/currency checks and exact amounts. Oversized
or interrupted reports finish the original claim as invalid with no daily spend
values. They never become zero-cost evidence, overwrite prior costs or trigger a
replacement provider request. The five existing independent sync lanes, customer
pricing, learning policy and UI remain unchanged.

`tests/seller-meta-costs.test.mjs` exercises the public sync service with native
streams: early rejection, open-stream cancellation and cleanup failures, exact
ASCII/multibyte character limits, split UTF-8 and BOM handling, alongside the
existing amount, account, timezone, error and pagination cases. These are offline
failure reproductions, not measured production incidents or dollar savings.
No migration, provider configuration, paid test or activation is required.
