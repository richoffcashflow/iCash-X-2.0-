# Buyer voice and title request release

## Implemented
- Buyer voice dispatch through the existing one-use scheduler and ElevenLabs/Twilio adapter, max reviewed duration, operating reservations, Stop/manual takeover, contact hours, DNC/suppression and explicit phone permission.
- Buyer permissions must bind a same-account profile, matching exact phone with provider DNC false, current confirmed buying criteria, a matched signed deal, approved marketing, current asking price, and prepared buyer package. New discovery is never consent or buying intent. Buyer callbacks use the existing verified callback pipeline.
- Buyer prompt identifies the AI assistant, quotes only the approved asking price, protects seller purchase price/margin, and requests review for negotiation/showings/payment. No automatic buyer acceptance or fake delivery claims.
- Title opening request API and compact control within existing deal details. One verified closing contact matching saved contract email, a production executed purchase PDF, a reviewed title_email rate, funds and one-use claim are required. Resend acceptance records `sent` only. Unknown sends remain held; there is no blind retry.
- No document sends, emails, paid lookups or calls were made during this release. Mock voice, title, billing tests and rollback SQL checks passed; production build passed.

## Configuration / incomplete work
- Company available funds remain zero. No operating funds or provider balances were invented.
- Live voice configs still require reviewed production agent hashes, number IDs, duration quotes and account-specific contact permission records. Buyer profiles need current criteria and actual verified contact bindings; they are not auto-confirmed from data discovery.
- Title requires RESEND_API_KEY and ICASH_TITLE_FROM_EMAIL (verified sending identity), plus a reachable monitored reply mailbox. Each title contact must be independently verified and bound in service-only icash_title_contacts with a title_email cost rate. No contacts or cost rate were fabricated.
- Title reply ingestion, escrow/title opening confirmation, deposits, closing confirmation and final settlement are not implemented by the email sender. It is an opening request only, invoked with customer confirmation; autonomous title-email scheduling is not included.
- All-provider actual cost ingestion and automatic invoice allocation remain incomplete. Full cost manifest settlement exists, but requires reconciled inputs.
- Stripe mock checks passed, but provider sandbox renewal/webhook end-to-end verification remains outstanding. Signing mode still requires DOCUSEAL_MODE=live. Production checkout remains held by honest launch readiness.

Sources: https://resend.com/docs/api-reference/emails/send-email ; https://elevenlabs.io/docs/api-reference/twilio/outbound-call
