# Bounded conversation and receipt recovery

The owner's November 16 reliability request led to three reproduced failure
modes. These changes preserve the approved workspace presentation and ordinary
customer controls.

| Trigger | Previous behavior | Corrected behavior |
| --- | --- | --- |
| A saved-contact read or conversation-open response never completes | The property panel can stay loading or busy indefinitely. | Use the existing bounded client request lifecycle and existing reload/retry controls; reject stale results and malformed optional contact data without erasing saved conversation history. |
| A canonical text receipt has an oversized or mismatched-origin body and transport cancellation never settles | Cleanup can prevent the original attempt from being journaled and hold the maintenance cycle. | Observe cancellation failures without awaiting cleanup; preserve the original read outcome, finalization, sibling progress and all existing receipt holds. |
| A seller answers a legal-name question with an unpunctuated supported process or fee question | The question can be stored as the seller's name and reused on the following turn. | Share the existing exact informational-question classifier with answer evidence; answer the question while leaving identity unconfirmed. |

## Verification

Regression coverage uses local component fixtures, native response streams and
fictional seller histories. Each failure is reproduced against its prior source.
Existing delivery-recovery database tests verify original receipts, late callbacks
and unchanged financial/contact authority. These are executable scenarios, not
claims of live customer deliveries, successful calls or completed deals.

## Release

There is no database migration, provider configuration change or activation.
The seller and receipt changes require the normal application/worker release;
the contact panel uses the same application release. Use the existing serialized
automatic release path, exact-head and exact-main Reliability checks, matching
production host evidence and bounded read-only feature checks.

Never retry a provider operation to demonstrate these repairs. A failed or
unknown receipt remains unknown. The contact-open action creates or reuses a
conversation and sends nothing; request timeout does not prove that its server
action failed, and it must not trigger an automatic mutation retry. No historical
seller replay, account reset, credit purchase or paid test is part of this work.

Remaining production account findings and incoming-number warnings are separate
from these reproduced bugs. Service uptime and a healthy learning refresh do not
establish that those findings are resolved or that every future scenario passes.
