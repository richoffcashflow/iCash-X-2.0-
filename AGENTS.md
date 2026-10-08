<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Product display preference

- Keep all product UI monochrome: black, white, and neutral grays. Use labels, icons, borders, and contrast for status and emphasis instead of colored alerts, buttons, or badges.
- Use 12-hour clock time with explicit AM/PM everywhere users or owners see or enter a time. Never display military / 24-hour clock time, including in admin tools, schedules, notifications, date/time pickers, and new features.
- Set `hour12: true` and an English AM/PM locale for formatted timestamps. Use the shared `DateTimeInput` for date/time entry; native `time` and `datetime-local` controls can display military time depending on the device.
- Keep timestamps, numeric scheduling hours, and timezone calculations in their existing internal formats. Playback positions and durations are elapsed time, not clock time.
