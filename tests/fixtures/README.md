# Workspace UI fixtures

These are fictional local test records. No account data, provider calls or real messages are used.

1. Run `npm run dev -- --port 3005`.
2. Run `node tests/fixtures/serve-workspace.mjs`.
3. In a browser on the same machine, open `http://localhost:3006/?fixture=volume`.

The fixture server intercepts **every** `/api/` path. Only non-API assets/pages are forwarded to the local Next server. Unimplemented API actions fail closed. It is bound to loopback, has no production route and must not be published.

Scenarios: `volume` (48 fictional properties, paginated requests), `empty`, `error`, `guest`.

Verification checklist:
- 320 px and 390 px mobile widths: no sideways scrolling; all buttons and form fields reachable
- Desktop width: clear status, Needs you, properties, account/help hierarchy
- Requests: expand/collapse, next/previous batch, acknowledge, open off-page property, return to all
- Search: mixed-case city/address, no match, unsupported punctuation error, clear, query pagination
- Stage filters: keep request queue independent, retain drafted messages while hiding/showing a property
- Take over: show explicit paused state; return requires server success; no call transfer claim
- Messages: incoming light/outgoing dark, explicit speaker labels, readable timestamp and state; contact switching preserves typed draft
- Calls: saved transcript direction labels; earlier/end pagination where API supplies a cursor
- Contract changes: no refresh overwrite while dirty; confirm before page change/search/sign-out; browser reload warns
- Failure: error state preserves prior records and drafts, retry recovers; held send has check-status action without blind resend
- Reload/deep link: `/?screeningId=00000000-0000-4000-8000-000000000043` opens the specific property
- Keyboard: visible focus; search, filters, summaries, request actions and forms work without pointer
- Reduced motion: no forced animated scrolling
- Guest setup: name → saved creation → funding order remains; unsigned preview copy does not promise nationwide signing

Automated coverage is in `tests/workspace-view.test.mjs` and `tests/workspace-activity-route.test.mjs`. Browser visual checks are separate from those tests and must be recorded explicitly; test success is not proof that screenshots were inspected.
