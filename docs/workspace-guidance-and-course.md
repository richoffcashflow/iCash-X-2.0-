# Workspace next actions

The expanded property card shows the user's next action and opens the relevant existing controls. Cancellation, signatures, human requests and closing issues take precedence over routine setup. Stale records prompt a refresh. Navigation does not sign, send, release a hold or save anything.

Buyers & closing explains what the user, iCash X and title each handle. Title setup has three saved steps: verified title company, payout preference and details shared directly with title. Saved preferences do not mean funds have arrived or the transaction has closed. Viewing access still needs seller and buyer confirmation.

The existing buyer-outreach hold is displayed from the owned deal's read-only status. The owner's test-only hold must remain until they explicitly authorize releasing it.

## Course portal

The workspace Course link opens `/course`. Members see the course video, a PDF download, then the client practice workspace at `/preview/workspace`. A large gold VIP banner links Standard members to `/?upgrade=vip`, opening the existing verified plan review after workspace acknowledgment. The banner does not grant access or charge; the existing billing consent remains required. Active VIP members see their included tools instead.

The platform owner opens **Manage course files**, unlocks owner tools if needed, and uploads the video (MP4/H.264 recommended or WebM, up to 2 GB) and PDF (up to 50 MB). Direct signed TUS uploads use 6 MB chunks with bounded recovery. Upload completion, MIME type, size and revision are verified before publishing; interrupted uploads keep the existing file and stale tabs cannot overwrite a newer version. Each file can be replaced independently. The initial portal shows an honest pending state until files are uploaded.

`icash_course_assets` and the private `icash-course` bucket are server-only. Every file read verifies customer membership; playback and PDF downloads use expiring signed links. Uploads additionally require the platform owner's verified identity, dashboard proof, origin check and rate limit. The portal is available before first-entry work acknowledgment, but cannot accept it or start work.

The practice workspace is public, unindexed and entirely fictional. It starts with a new lead and lets customers explore each stage, sample contracts, manual takeover and contract editing/cancellation without account lookups, messages, signatures, payments or terms acceptance. Navigation returns to the course or the real workspace. Internal recovery fixtures appear only with the existing explicit recovery query.

## Verification

Use local fixtures for next-action priorities, title/payment states, navigation focus and authenticated fulfillment reads. No paid provider simulations, calls, messages or signature requests are authorized for development testing.

Course regressions cover member and owner access, scoped uploads, incomplete files, stale revisions, idempotent publication, storage grants and inert practice fixtures. Browser fixtures exercise playback, PDF downloads, owner uploads, course navigation and explicit VIP upgrade consent on desktop and phone layouts.

Course upload controls are visible above the video for the verified platform owner on desktop and mobile. Locked owner sessions show Unlock owner uploads in the same place; customers do not see publishing controls. The video and PDF are still published only after the complete-file check.

## Course viewing and support

Course discovery is visible before workspace acknowledgment and through a prominent **Training course** header link and account-menu entry. Opening the authenticated course records a separate account-bound discovery timestamp. On returning to the workspace, the course reminder card and automatic walkthrough stay hidden, including after refresh or on another device. Existing recorded playback also suppresses those prompts. Explicit menu replay and the course's **Continue workspace walkthrough** link still work; replay cannot clear discovery. Failed progress reads leave the permanent course links available without reintroducing a prompt.

Opening the course does not count as watching, complete the walkthrough, accept terms, change access or start work. The discovery POST is origin/rate/ownership checked and uses an idempotent service-only function; GETs remain read-only. Install `20261105145849_course_opened_reminder.sql` before deploying the application. Its nullable column and separate function are compatible with the previous web/worker versions. No worker restart or provider change is required. The ordered migration was installed once on November 5 at 14:58:49 UTC; its recorded SQL matches the repository, the function hash is `a80dcef075f04e1a0e52898780255d21`, and execution remains service-only with RLS unchanged.

Course playback is now saved per account and video revision. The browser reports actual played ranges in milliseconds at most every 30 seconds during playback, and on pause, completion or leaving the page. The authenticated endpoint validates and merges ranges, so seeking and replaying do not count skipped or duplicate time. At least 95% recorded coverage marks the current video watched. Replacing the video starts a new progress record. This is viewing telemetry, not proof of comprehension and never an access or bot-work requirement.

After a replacement video is published, members who had access to an earlier version see **Updated** beside **Training course** in the workspace header and account menu. The course link before workspace acknowledgment also identifies the update. Eligibility follows earlier course access or playback, including verified members who never opened the earlier video. The label stays through page visits and partial playback and clears at 95% recorded coverage of that video. PDF replacements use their own revision.

The progress table and functions are service-only. Support reads only the selected account’s current-video summary. No record means no playback is recorded, including customers who watched before tracking or offline; it must not be described as proof that they never watched. Course reminders do not replace help with billing, access or operational failures. Completed informational answers resolve promptly, and another message reopens the conversation.
