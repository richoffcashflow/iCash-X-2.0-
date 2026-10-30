# Original iCash X support

The owner confirmed on October 30, 2026 that iCash X 1.0 is no longer active and is being shut down. Support explains that 2.0 is the current platform without inventing a shutdown date, claiming old access can be repaired, or sending sign-in-code instructions in response to migration questions.

Original buyers can email their purchase receipt to `support@geticashx.com`, subject “iCash X 1.0 purchase proof.” The existing receiving mailbox is enabled. Chat does not accept document uploads. A customer saying they sent proof keeps the case open; it does not confirm receipt or verification. If the receipt is missing, original purchase email, approximate date and amount can help locate the original record.

In the support inbox, open the customer's conversation and **Original iCash X 1.0 purchase review**. Use **Open receipt inbox** to read the original email and attachments. Check the receipt against purchase records and confirm that it belongs to the customer. The visitor's email, chat assertions and a 2.0 payment are not original-purchase proof. Receipt contents remain private; do not paste them into the conversation. Owner email copies keep their existing configuration.

After review, select the explicit purchase-verification checkbox and send the previewed offer. Both account and guest admin routes require the existing trusted support-operator authorization, same-origin request, strict input and idempotent request ID. The server supplies the fixed offer text. The existing transaction records the operator identity and message, and queues the existing customer notification once. A retry does not create a second offer message. User message endpoints reject verification fields; arbitrary operator URLs continue to be redacted.

The existing `/legacy-offer` checkout and billing rules are unchanged: two calendar months of software access for $0, then $50/month unless cancelled; a payment method is required and work credits are separate. Sending the offer does not activate access, grant credits, migrate data, or mark an access fault resolved. No new automatic grant, billing action, email-proof parser or campaign send is introduced.

The deterministic migration response works for signed-in and guest chat without a model. Short migration follow-ups stay attached to that topic. New billing, product and 2.0 sign-in questions replace it. Guest support no longer treats its location or an old code conversation as proof of a current sign-in fault. Repeated-question filtering and model validation reject standalone safety cautions. Unknown answers request useful clarification.

Offline checks: `support-legacy-migration`, `access-help`, `access-support-investigation`, `support-conversation`, `support-message-content`, and the remaining support suites. Fixtures replay the observed wording and use simulated operators, database and provider results; no real customer messages or paid AI calls are used for verification.
