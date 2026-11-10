# Seller contact controls and direct cash questions

The November 9 owner screenshots showed a customer account view with saved text/call history but no reply composer or calling action. The owner explicitly requested these contact controls and changes to the text/call panels. The simple main workspace stays unchanged.

## Conversation behavior

- Saved messages load independently of live manual-send/contact checks. An admission timeout leaves history and drafts available. A separate availability request controls the composer; the existing POST still performs final admission.
- The customer and owner customer-view panels use the same composer, draft/uncertain-send recovery and browser call session. Selecting the property Call action starts the call when one eligible saved number is available; multiple eligible numbers require a choice. Browsing the Calls tab only opens history. Microphone permission and current calling checks still apply.
- Owner contact requests require the canonical owner, dashboard proof, current Auth session and an expiring view bound to the selected customer. Request bodies cannot override the account or actor. A narrow database wrapper retains the real owner actor in message, call and takeover receipts, plus a private minimal audit. It grants no customer Auth session and no account Pause/Run, funding, signing or unrelated controls.
- Manual contact takes over the property using the existing control chain. Return to bot uses that same chain and does not clear its unresolved handoff restrictions. The exact owner-started call can still be ended after the view closes/expires, while the original owner Auth session remains valid.
- Owner reads do not consume customer unread receipts. Message labels distinguish the customer, owner operator and AI bot.
- The latest seller bubble remains visible when the composer resizes. Confirmed automated greetings/screening fragments are excluded from the main call list and retained under Past automated recordings. Any saved human/ambiguous turn remains visible.

The top funded account audit found 511 accepted/delivered outgoing texts and zero recorded incoming texts, including no matching ingress events for its sender/recipient pairs. The interface cannot manufacture absent replies. Confirmed automated call fragments were reproduced with fictional numbers; original recordings remain intact.

The owner's follow-up selected a conversation layout with Call above the thread, recordings among texts by default and a slim bottom composer. Generic Texts entry reselects the latest seller-reply thread; explicit thread links remain exact. Selection stays pinned during a session so polling cannot move a draft to another contact. Reopening preserves each contact's draft. Initial scrolling shows the latest seller text; scrolling or sending returns control to the user.

Call history loads separately from texts and admission checks. Browser/manual call recordings use saved account/property/recipient-bound rows and the existing authenticated audio endpoint; playback still verifies original provider evidence. Failed/expired audio never appears as playable. The top Call action uses the selected conversation's exact number, with no fallback to another saved contact. Active call controls stay above the thread when switching tabs. No schema, provider configuration or activation change is required for this follow-up.

## Direct cash questions

New `cash-question-v6` assignments use three fixed reviewed variants:

| Variant | Copy |
| --- | --- |
| `cash_sale_v6` | Hi, have you considered a cash sale for {address}? |
| `all_cash_v6` | Hi, would you consider selling {address} for all cash? |
| `cash_offer_v6` | Hi, would you be open to a cash offer for {address}? |

Allocation is stable and balanced by account/property for existing eligible learning accounts. Owner/test/intake cohorts use the default cash-sale copy and are excluded from comparison by the existing eligibility predicate. Enabled variants must match the approved renderer exactly. Preserve the literal street and one-segment alphabet/length checks; no extra signature, company introduction or ownership question is added. The original sender, source, timing, financial, Pause, opt-out and final dispatch gates remain in force.

A response to this selling-interest question never populates `owner_reply_id`. The existing inbound continuation uses the recorded cash question without asking the cash-interest question again. Dialogue can collect nonbinding property details while actual ownership, offer and signing evidence remain separate. A fresh explicit “Who is this?” gets the short cash-buyer response. Direct AI/human questions disclose the AI assistant. Company, source, assignment and direct-buyer restrictions retain their separate response/review paths.

`icash_seller_cash_question_report()` is a service-only descriptive comparison: original delivered first exposure per account/property, 72-hour mature windows, any replies, exact affirmative answers and opt-outs separately. Unknown delivery and owner/test cohorts do not enter the denominator. A later opt-out removes positive classification. Historical sends and old learning cohorts are never relabeled. No winning template or conversion lift is claimed; balanced allocation remains until sufficient outcome evidence supports a separately reviewed allocation change.

## Verification and release

Focused tests exercise real captured queue/call/control functions, account/view/session isolation, retained admission holds, exact-key retry, private audit, safe hangup, fresh identity replies and mature/immature outcome distinctions. Native PostgreSQL additionally checks old compiled queues across installation, competing queues and late Pause/source withdrawal. Desktop/mobile browser fixtures exercise message visibility, blocked checks, drafts, scoped manual send, call history and account switching without contacting providers.

Install `owner-contact-actions.sql` and `seller-cash-questions.sql` disabled using their ordered migration receipts. Their exact predecessor hashes must match. Verify the exact PR Reliability checks, normal merge, exact-main CI, production web aliases and affected Railway worker before activation. Under the existing budget/advisory locks, enable `icash_private.owner_contact_settings.enabled` and set `icash_learning_policy_private.cash_question_settings.enabled_at=now()` once. Never backdate the cutover, rewrite existing messages or run paid demonstrations.

Rollback disables those settings. Existing v6 questions keep their meaning, original source records remain immutable, and exact owner-started call hangup remains available after the contact feature is disabled. Rollback does not reinterpret cash-interest answers as ownership.
