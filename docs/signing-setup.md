# Ordered signing and authorized auto-signing — DocuSeal

Use the platform's DocuSeal account, not customer accounts. SignWell was evaluated first but its API cannot execute the requested auto-signature. No SignWell account is needed.

## Configuration required before activation
1. Create the platform account/API access at https://console.docuseal.com/ . Use the provider's sandbox/test API key in `DOCUSEAL_TEST_API_KEY` on Vercel. The application defaults to test mode and never falls back to the live key. No document has been sent during deployment.
2. Add reviewed purchase/assignment templates for each supported state and required signer count. All sellers sign first; the customer is last. For assignment, cash buyer(s) sign first. Templates need an electronic-signing consent checkbox and required signature for every party. Verify consent UI and delivery in the sandbox. No pre-signed seller content.
3. Private `icash_signing_templates`: set provider=`docuseal`, numeric provider_template_id stored as text, state_code, kind, signer_count excluding customer, ordered placeholder_names matching DocuSeal roles, field_map, review_reference, reviewed_until, test_mode, enabled. Map EVERY `dealTermsSchema` key to a DocuSeal text field owned by the first signer; all transmitted terms are readonly. Monetary fields are dollar strings. The reviewed template must express 30 days after the effective date when closingDate is blank and accommodate long legal descriptions without clipping. The service does not turn generic draft wording into a reviewed legal form automatically.
4. Auto-sign requires `automated_signing_reviewed=true` and the final customer's `customer_signature_field`. The DocuSeal guide documents auto-signing on behalf of a company. Confirm supported delegated authorization for individual/sole-proprietor principals and applicable contract requirements before enabling their templates. This must be a real signature field, not an image pasted into document content.
5. Test the full flow with controlled recipient emails: seller consent, multiple sellers, final customer access, exact values, explicit typed-signature authority, revocation, pause, expiry, duplicate result polling, signed PDF and audit trail. API integration is implemented but not provider-tested without credentials.
6. For live mode configure `DOCUSEAL_API_KEY`, `DOCUSEAL_MODE=live`, live reviewed templates, and an enabled `contract_signing` rate covering all costs at the existing 5x floor. Operating cash and customer credits remain required. Reconcile actual provider billing before final wallet settlement; no invented cost.

## Delivered behavior
- Private authenticated send/status/download routes inside existing property cards. User must approve the reviewed terms and recipient list before sending.
- Verified account email for the customer; signing links for other recipients never returned to that customer. Email 2FA requested for recipients.
- Exact agreement snapshot/hash, provider submission and recipient binding, one envelope per deal/kind/mode, no automatic replay on an unknown send failure.
- Purchase terms freeze at live dispatch. Assignment-party/fee/deposit and proceeds-preference fields can change after verified purchase completion until assignment dispatch; changes to purchase terms require an amendment.
- Durable private worker status polling every ten minutes for up to 45 days, plus bounded manual refresh. No public callback can assert signatures.
- Once all other parties sign, Action required appears for the customer. Optional auto-sign is OFF by default, requires typed electronic signature authorization for this exact agreement, expires within 30 days, is tenant-bound, revocable before claim, and never reusable for another agreement. Future account-wide standing authorization and drawn-signature reuse are not included.
- Before auto-sign, fresh provider data must show all other signers complete, exact recipients and mapped term values. Account pause/property takeover blocks the single-use signing claim. Provider write is never blindly retried; later reads reconcile uncertainty. Final completed status is re-fetched before advancing the deal.
- Test completions never set under_contract. Completed PDF and separate audit trail downloads are fetched from the provider. Persistent binary archiving and provider cancellation/amendment workflows remain unfinished.

Sources:
https://www.docuseal.com/docs/api
https://www.docuseal.com/guides/pre-fill-pdf-document-form-fields-with-api
https://www.docuseal.com/pricing
