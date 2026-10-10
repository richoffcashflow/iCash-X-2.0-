<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Product display preference

- Keep iCash product UI monochrome: black, white, and neutral grays. Use labels, icons, borders, and contrast for status and emphasis instead of colored alerts, buttons, or badges. The public HomeOffer Network seller page (`/sell`, homeoffernetwork.com) is an explicit exception: preserve its original coral-orange accents, warm supporting colors, and neighborhood photography.
- Use 12-hour clock time with explicit AM/PM everywhere users or owners see or enter a time. Never display military / 24-hour clock time, including in admin tools, schedules, notifications, date/time pickers, and new features.
- Set `hour12: true` and an English AM/PM locale for formatted timestamps. Use the shared `DateTimeInput` for date/time entry; native `time` and `datetime-local` controls can display military time depending on the device.
- Keep timestamps, numeric scheduling hours, and timezone calculations in their existing internal formats. Playback positions and durations are elapsed time, not clock time.

- Keep call connection instructions short. Do not put recording announcements or internal cost multipliers in the call controls; recording behavior belongs in the service implementation.
- Buyer outreach uses outbound SMS and email only. Never schedule or dispatch outbound AI calls to buyers. Preserve inbound buyer calls and outbound seller calls.
- Buyer packages must not describe where property images came from. Use neutral captions and image descriptions such as Street view, Aerial view or Property photo; keep source metadata internal.
- The owner approved displaying the assignment fee on the original assignment contract (`owner_original_20261009`) on October 10, 2026. Keep acquisition pricing blocked in buyer agreements and keep the fee/spread private in buyer packages, AI conversations, texts and emails. Preserve the original non-refundable deposit clause; new buyer EMD is 20% of the fee, capped at $5,000, with only the deposit dollar amount shown to buyers outside the contract.
- Customer credits are charged for completed usage. Do not withhold the maximum quoted amount from the wallet or impose daily/lifetime activation spending caps. Keep idempotent usage authorizations, actual-cost records, bounded calls, paid access, contact permissions, and zero-balance admission checks.

# Development test spending

- The owner stopped paid provider simulations after test runs exhausted ElevenLabs credits. Keep paid development simulations disabled, including direct CLI commands, deployment hooks and retries.
- Use local fixtures and saved transcripts. New paid tests require fresh explicit owner approval of a concrete spending limit and a mechanism enforcing that limit. Earlier requests to test or ship are not approval to resume paid tests.
- Never purchase credits, enable auto-recharge or change provider billing to continue testing without explicit owner authorization. Preserve failed and interrupted evidence; do not call incomplete evaluations passed.
- This restriction covers development/testing spend. Preserve ordinary customer production usage and the actual-cost billing rules above.
