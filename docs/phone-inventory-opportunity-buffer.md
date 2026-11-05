# Phone inventory and the new-work buffer

The November 4 production audit found one account with 25 pending opportunities,
exactly its configured maximum. Fourteen had settled owner data, but every current
phone was already held by another account's inventory claim. New discovery stopped
because the buffer counted these unavailable contacts. Seven other entries had
unknown purchases and correctly remained held.

The read-only pending count now excludes an entry only when its original owner
purchase is settled and its saved result matches the same account, screening,
property and operation. Every original eligible phone must normalize successfully,
belong to the saved requested person set, and have an unrevoked current operational
contact bound to that exact result hash and current sending identity. Every such
phone must also have an unexpired claim owned by another account.

Any unprepared or malformed phone, missing or empty likely-owner phone array,
available alternate operational route, current legacy permission, or unknown
same-property purchase retains the slot. Queued/running screenings keep their
existing behavior. Claim expiry or reassignment is observed on the next read.
Original contacts, ownership and phone claims, payments, permissions, admissions,
customer controls and unknown purchases are unchanged. This projection permits
only the existing scheduler to consider independent work; it never retries an old
purchase or sends outreach.

Baseline source is main `5b3f71252238a19ac3df99d5205b9dae7d1f3236`.
The migration requires pending-count definition MD5
`ff6c4426d808dfa8ee785e6068f28339` and phone normalizer MD5
`2b62a1db7f708fb6ed2b178cf98d6bbb`. The original function metadata and ACL are
retained, and the resulting definition is verified before commit. The migration
was generated with Supabase CLI 3.0.0; no production installation is claimed here.

The executable offline fixture reproduces 25 slots before the patch and 11 after,
including the seven untouched unknown operations. It tests source/tenant/identity
binding, original phone alternatives, legacy and current alternate routes,
malformed/null entries, missing evidence, claim expiry and read-only privileges.
The native CI fixture also runs concurrent reads while another transaction holds
and releases a phone claim, then confirms the next read restores its slot.

A bounded production SELECT of the proposed predicate predicted the same 25→11
change without installing anything. Its November 4 read-only EXPLAIN ANALYZE
completed in 40.058 ms (10.879 ms planning, 4,500 shared hits, zero shared reads),
under a five-second timeout. This measures the affected account, not a global
performance guarantee. Exact release checks and production installation/readback
remain required before claiming recovery.
