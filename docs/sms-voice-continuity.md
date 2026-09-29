# SMS and voice continuity

Seller voice dispatch now reads up to 12 recent, bounded SMS messages for the same account, screening/property, party and phone. Only received incoming messages and accepted/delivered outgoing messages are included. Practice and closed/cancelled deals are excluded. The exact context is persisted on the voice job before the provider request. It remains conversation evidence: it cannot change offer limits, payment instructions, permissions or booked appointments.

Incoming seller call requests create one durable pending item per thread. Repeated requests update that item; explicit call cancellation and opt-out phrases cancel it. Practice messages are excluded. No historic messages are replayed. The dashboard prioritizes the property, shows the request inside its details, and allows the signed-in account to mark it handled. This does not claim a booking, enable automation or unpause the property.

Automatic SMS-to-call scheduling is still incomplete: these requests need time confirmation and the existing verified voice-dispatch setup. This release does not dial from a message, grant contact permission, change production spend controls or enable a practice agent in production.

Opener learning now tolerates delayed delivery callbacks. Actual replies received after the outgoing message can be associated when delivery is confirmed; undelivered sends are not counted, and explicit declines/opt-outs are excluded from successful-response metrics.

Verification: TypeScript passed; bounded-context and callback-policy tests passed; rolled-back database fixtures verified tenant/phone isolation, practice exclusion, repeat requests, cancellation, negative wording, delayed delivery, decline tracking, service-only access and absence of automatic voice jobs. No paid provider call or SMS was placed for these checks.
