# Updates panel read recovery

The updates inbox and notification preferences used browser reads without a
deadline. A stalled header or response body could leave the inbox's in-flight
guard set or keep preferences loading indefinitely. Invalid inbox data could
replace a saved list with `null` and crash its next render. A workspace event
during an existing read was discarded, and a preferences refresh could overwrite
an unsaved choice.

Both reads now use the existing 25-second request helper. Before state changes,
the component checks the rendered fields against the current API shape. Failed
refreshes retain the last valid inbox and expose its existing refresh button;
an outdated empty list does not claim the user is caught up after a failed read.
One pending workspace event is coalesced behind an in-flight read, with hidden
tabs, unmounts and late responses still ignored. Preferences refresh availability
metadata without replacing choices edited in the open form. A successful
preferences refresh clears consent so changed destination or availability
evidence cannot inherit an earlier checkbox acknowledgment.

`tests/workspace-updates-recovery.test.mjs` runs the actual two components and
request helper with fictional transport. Nine scenarios cover header/body hangs,
late response recovery, malformed payloads, a burst during a read, visibility,
draft retention and unmounts. The predecessor reproduced the stuck read, `null`
inbox render crash, discarded refresh and overwritten draft. The new suite is
registered for release verification.

No API, database, consent, send, billing or automatic-write behavior changes.
Preferences-save and mark-read POST handling are outside this read-side repair.
These fixtures do not establish live delivery or replace exact-release browser
and build checks.
