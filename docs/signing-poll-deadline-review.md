# Keep original signing receipt polls available during deadline review

A verified pending signing receipt could be saved successfully, then an existing
same-day or past closing-deadline guard threw before any signature authorization
was claimed. The worker treated this as an unclassified infrastructure failure
and backed off its shared slot on each ordinary receipt poll.

Only those two typed deadline outcomes now return the already verified and saved
`customer_signature_needed` status, with a fixed private diagnostic. This means
the receipt poll succeeded; it does not mean the agreement was signed or its
deadline was approved. The envelope stays eligible for ordinary original-receipt
polling so later verified signatures remain observable. No terms, authorization,
signature, notification, customer UI or existing unresolved-operation hold is
changed. No migration or activation is required.

Provider, field-binding, other readiness and receipt-save failures still fail.
Sending, customer signing links and final automatic signing keep the same deadline
guards and error messages. A deadline review never consumes an authorization;
expiry after a valid authorization claim still prevents the signature write.

The actual service regression uses fictional database/provider fixtures and
composes the real automation route and worker dispatcher. It covers past and
same-day deadlines, original and legacy forms, live/test envelopes, no signature
claim or new notifications, rejected field/source/save outcomes, ordinary future
signing and later completed original receipts. The changed regression fails on
the predecessor. Release still requires canonical exact-head/main checks and
matching production verification. Successful deployment or polling is not proof
that an outstanding agreement has completed.
