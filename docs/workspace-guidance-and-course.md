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
