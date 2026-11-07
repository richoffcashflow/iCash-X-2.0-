# Open a conversation that contains messages

The default seller thread already prioritizes unread and received replies. When
no incoming reply exists, it previously selected by descending random thread ID,
which can open an empty contact while recorded outgoing messages exist elsewhere
on the same property.

The guarded read-only selector patch preserves all existing incoming/unread
priority, account and deal scope, seller party and retired-thread checks. It adds
latest recorded message time and ID before the final thread ID fallback. Ready,
accepted and failed messages remain visible as their actual states; selection
never upgrades delivery status, marks messages read, resends work or changes
manual control.

`config/seller-default-conversation.sql` requires predecessor definition hash
`abe0b978f8ae0015509a8826d6c62bb6`. The resulting definition hash is
`3d04b594768e59e8840cbbba29279f7a`. The function remains STABLE and SECURITY
INVOKER with exactly its prior grants. An unknown/repeated predecessor fails
closed. The existing account/thread/time message index supports the new lookup.

The isolated PostgreSQL-engine fixture includes existing reply/read-route cases
and no-reply defaults, all outgoing delivery states, same-time ties, foreign
messages, empty-only threads, unread and already-read priority, retired and buyer
threads, unchanged ACLs and repeated-install refusal. No production write or
provider operation has been performed.

The pinned Supabase CLI 3.0.0 generated migration
`supabase/migrations/20261107212550_seller_default_conversation.sql`. The fixture
requires byte equality with the reviewed config. Before release, independently
review the SQL, inspect the exact current function and install only this
migration. Do not replay unrelated migration history. Read back hash and grants,
then recheck known same-account affected properties and incoming-priority cases.
The existing application calls this function; no frontend API change is needed.
