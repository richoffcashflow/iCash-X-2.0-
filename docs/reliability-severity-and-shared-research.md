# Incident priority and delayed seller research

An assigned website lead can reach its second recipient after the original 24-hour property check expires. The original customer price and eight-day sharing deadline stay fixed. The new maintenance path obtains one fresh property receipt for eligible unstarted outreach, records its research cost against the existing platform lookup allowance, and preserves the previous property/result in a private refresh record. Future recipients reuse the actual new research.

Refresh is keyed by the lead and original research timestamp. A timeout, ambiguous response or mismatched property is held without an automatic retry. Existing calls, incoming replies, provider receipts, spend records, manual controls, opt-outs, signed documents and stopped accounts exclude recovery. Only a held `fresh_screening_required` job with no provider attempt can become ready again. The same pending text and call IDs are retained; ordinary final dispatch checks decide whether they proceed. Customer charges, permissions and historical conversations are not rewritten.

The owner dashboard and incident emails use these priorities:

| Priority | Meaning |
| --- | --- |
| Minor | An isolated queued workflow delay, with healthy core services and less than 30 minutes elapsed. |
| High | A message/call receipt or contract needs review; monitoring is incomplete; any delayed item reaches 30 minutes; or at least five items / three observed accounts are affected. |
| Critical | The worker or maintenance service is degraded or unavailable. |

Severity can rise within the same incident. A new highest level generates one escalation notification; repeated checks and severity oscillation do not resend that level. Existing provider idempotency, uncertain-email protections and recovery notifications remain in place. The classifier covers the existing monitored workflows; it does not claim that every payment, sign-in or external provider is monitored.

Apply the research and severity migrations before releasing the application. Versioned alert claim/status responses preserve compatibility with the old app during deployment. Local PostgreSQL and provider-fixture tests cover exact research identity, receipt replay, changes during a lookup, private privileges, severity parity and escalation. Development tests make no live provider requests.
