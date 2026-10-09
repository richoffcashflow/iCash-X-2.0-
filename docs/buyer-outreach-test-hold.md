# Test a deal without contacting buyers

An owner-requested hold is stored for one account and deal. It stays active until explicitly released; completing signatures, preparing fulfillment, or rediscovering buyers cannot remove it. It does not pause the account, seller confirmations, inbound calls, buyer research, or package preparation. Outbound buyer calls remain disabled by the written-outreach-only release.

`icash_set_buyer_outreach_hold(account, deal, owner_user, held, reason)` is service-only and validates the owner/deal relationship. The hold table has RLS and no client grants. The setter and final send claims take the operating-budget lock first to serialize activation with send authorization.

While held, package target/contact queries exclude buyers, package SMS cannot be queued, and final automated/manual SMS and deal-email claims reject buyer sends even if those messages were queued before the hold. No send authorization or credit charge is created for the held message. Seller/title communication retains its existing checks. An already dispatched provider request cannot be recalled; inspect pending/accepted receipts before confirming a hold.

Production activation is a scoped operational action, not seeded account data in the migration. Release only at the owner's explicit request. Messages left ready still pass all existing recipient, suppression, signature, price, expiry and duplicate checks after release.

## Local verification

Run `node --experimental-strip-types scripts/test-buyer-disposition-pglite.mjs /absolute/path/to/pglite/dist/index.js`.

The isolated PostgreSQL fixture blocks network fetches. Actual SQL covers the seller-only signature boundary, completed purchase, one fulfillment job, purchase price plus $10,000, package privacy, queued-send holds, both SMS claim paths, requested package email, explicit release, duplicates, tenant isolation, unchanged seller delegation, and disabled buyer calls. Actual package service bodies are also run against the held fixture, with transports that fail if reached. Synthetic signatures and contact evidence are never inserted into production.

The shared fixture adapter types boolean filters from the real PostgreSQL column type, matching the PostgREST behavior used by services.
