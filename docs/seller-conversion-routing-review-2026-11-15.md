# Seller conversion routing review — November 15, 2026

Read-only investigation of the private report's seven-day sample found no reproducible routing defect in its nine `currentMissingAiJob` observations. This counter describes missing source-bound AI jobs; it does not establish that nine replies are currently sendable or that their conversations stopped.

## Observed evidence

- Eight incoming sources and their screening snapshots were older than 24 hours at inspection. Their stored progress reasons were five `reply_not_routed`, one `contact_checks_required`, one `contact_stopped`, and one `manual_control`. Two also had account/thread controls. These are current observations and stored progress snapshots, not a reconstruction of admission when each message arrived.
- The remaining source was fresh, had no recognized conversion intent, and had no source-bound AI job or deterministic SMS reply mapping. Source freshness alone does not select a dialogue or offer action.
- That fresh conversation continued through a seller call completed 123 seconds after the incoming SMS. The completed result matched a recorded call on account, screening, operation, contact, and provider conversation identity.
- Its later outgoing message belonged to that call's `no_response` recovery gap and recovery attempt. The gap was scheduled four hours after call completion. The outgoing message was `ready`, with no provider submission. This proves a queued call follow-up, not delivery, acceptance, an answered SMS, or successful seller conversation quality.
- None of the nine incoming sources had a bound inbound campaign invitation, an outgoing message keyed directly to the source, or a source-bound SMS call-request row.

## Interpretation and limits

Campaign routing can intentionally finish without an AI job when a deterministic route handles the source or current admission fails. Later dialogue and offer triggers create jobs only for supported, admitted actions. The progress reason `reply_not_routed` has no retry time and is a review observation, not dispatch authorization.

The report intentionally measures independent source samples. A later call and its follow-up are not counted as an answer bound to the earlier SMS. Therefore `currentMissingAiJob` and `currentUnsubmitted` must not be interpreted as conversation-wide inactivity or total queued work.

One separate code coverage limitation remains: the bound automatic-reply union does not include `icash_sms_inbound_invitations.reply_id → message_id`. No such invitation was present among these nine observations, so it does not explain this sample. This review does not quantify its impact elsewhere.

No historical admission was replayed, no provider action was taken, and no jobs, controls, or production rows were changed. Queries returned only aggregate counts, statuses, timing relationships, and binding checks; no raw identifiers, phone numbers, message bodies, or transcripts were exported. No routing code change is justified by these observations.
