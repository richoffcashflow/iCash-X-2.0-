# Personal, concise support replies

The November 7 owner request is to make support feel like a personal conversation without treating a long paragraph as a requirement for warmth. This change builds on the already released current-step fixes in #606. It does not reopen the older #283 preview or its UI and handoff changes.

The shared model instructions now default to one or two short sentences, respond to the detail that matters, and allow a brief acknowledgment to stand alone. Longer or multi-part answers still retain every necessary fact and limit. Short follow-ups answer the new point rather than restarting the whole explanation. Do not add invented empathy, familiarity, promises, repeated greetings or closing questions.

Known replies remain deterministic and do not require a paid rewrite. Seller-name and purchase-signing follow-ups use shorter replies while retaining the legal-name, every-seller and exact-document review requirements. Management-review answers state the unresolved issue, review status and uncertainty once, rather than repeating a status sentence. Routine acknowledgments use “Got it.” without closing an unresolved issue.

A later owner clarification requires avoiding management review for routine questions. The exception requires both a trusted local product-answer branch and an informational question. Repeating that guidance alone does not trigger review. Complaints and repeated troubleshooting replies keep the existing review path. Explicit review requests, repeated unknown answers, unresolved access and payment review remain intact. Existing review cases can still receive direct routine answers without another escalation notice.

The change does not alter account operations, signatures, payments, refunds, case persistence, AI identity or delivery. No text is mechanically truncated. Complex complaints and initial signing explanations keep their full necessary detail.

`tests/support-personal-tone.test.mjs` exercises regular and recovery responses, guest and signed-in acknowledgments, short follow-ups, open-case status, multiple complaint parts and the shared model prompt with a mocked transport. These tests do not contact customers or external models. The suite is included in local release verification; canonical exact-head Reliability checks and exact-main production verification remain required for release.
