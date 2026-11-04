# Explicit buyer handback after manual signing

A property takeover pauses automatic buyer work as well as seller work. Completing
the purchase agreement does not release that deliberate control. The workspace
now explains this on the signed property's collapsed card and offers **Let bot
find a buyer**. Only the owner's click sends the existing `return_to_bot` request.

The prompt requires a completed, explicitly live purchase envelope and an
under-contract deal. Practice, an unresolved signature, a completed assignment,
an active buyer journey, or attention requiring a person keeps its existing
priority. A stage label alone is insufficient. Successful return does not claim
a buyer search has run; account Pause, setup, funds, recipient permissions and
all existing service/database admission checks still apply. A failed save keeps
the property manual, and an in-flight request cannot be duplicated by another
click. Read-only views have no action; stale customer views disable it.

Production seeds routine closing setup and contract-date reviews when a purchase
is signed. Those requests remain visible, and deadline review retains its current
action priority, without obscuring this handback. Recovery and delivery issues
remain blocking. The activity read
therefore retains `propertyAttentionIds` and derives
`propertyNonSetupAttentionIds` from the same six account-bound, visible-property
existence queries. Only the closing reason is projected; no additional query or
request content is introduced. Unknown reasons remain blocking. The independent
summary catches human requests outside the selected attention page; older
responses without it retain the conservative original aggregate. This is a
presentation hint, never a new automation authorization.

Offline regression coverage:

- `workspace-buyer-handback.test.mjs` executes the actual collapsed card and its
  control handler: explicit return, duplicate clicks, failed save, account Pause,
  read-only/stale restrictions and production-style seeded closing setup.
- `workspace-next-actions.test.mjs` covers live signing proof, conflicting
  signatures, human attention, practice, active buyer journeys, routine setup,
  off-page attention and missing-summary fallback.
- `workspace-activity-route.test.mjs` covers the reason projection, unchanged
  bounded queries, tenant scope, unknown reasons and independent attention pages.
- `workspace-browser-scenarios.mjs` exercises the new button on a collapsed card,
  a failed request, successful return and account Pause in desktop/mobile browser
  scenarios. The release workflow runs this with its existing browser matrix.

No paid outreach or signing was performed for development. Multi-owner automated
signing remains a separate limitation; the existing manual agreement tool can
add every required signer. This change does not infer owners, omit signers or
automatically resume a property after a signature.
