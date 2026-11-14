# Natural seller delivery — November 14, 2026

The owner requested friendly, helpful seller interactions with natural tone and cadence. The practice voice already had detailed delivery guidance, while production seller calls mostly had generic brevity and interruption rules. This change adds delivery-only guidance to the existing seller runtime composition and makes three application-generated SMS answers easier to understand.

## Behavior

- Warm, patient speech with natural contractions; match the seller's pace and formality. Acknowledge relevant details without echoing every answer or repeating the seller's name.
- Avoid a repetitive acknowledgment/question rhythm, forced slang or laughter, and cheerful praise after worry or bad news. Explain confusion before asking more; respect a busy seller.
- Keep interrupted answers brief and relevant. Let names, dates and amounts finish. State the next available action, use its existing tool, and describe the actual result.
- Text price objections invite a relevant property correction without challenging the seller. Costs remain qualified by seller obligations and the title company's confirmation. A complete process answer no longer ends with a generic question.
- Old and new versions of those three exact informational answers share the existing two-delivered-reply limit. Historical messages and receipts remain unchanged.

The selected voice, provider acoustic settings, frozen provider policies, prompt ceiling, authorization, recipient routing, agreement readbacks, billing and UI remain unchanged. The runtime role gates continue to exclude buyers, unknown/ambiguous callers, limited seller discussions and cancellation calls. No random reply variation, artificial typing delay or new model/provider call is introduced.

## Verification and release

New offline tests exercise actual prompt assembly and role scope, quoted untrusted history, idempotence and the existing prompt budget. The text replay exercises the real application planner and service, the source fingerprint/version save boundary, legacy wording, pending delivery and explicit punctuated refusals. These are instruction and deterministic execution tests, not generated audio evaluations.

Use the existing Automatic iCash releases controller after independent review and canonical checks of the exact PR head. This code needs no database migration, policy activation or provider configuration write. It composes with the separate seller-conversation flow work in PR #728; neither patch may overwrite the other's changes. Verify the exact production application before describing it as live. No paid demonstrations or retrospective seller messages are part of this change.

## Separate audit finding

An added mixed-message fixture exposed a pre-existing source-classification gap: `STOP Your offer is too low`, `STOP, Your offer is too low` and `Stop sending messages. Who pays closing costs?` are not recognized by the current source classifier or upstream Contiguity event classifier. `STOP. Your offer is too low` is recognized. This copy-only change does not modify the shared TypeScript/SQL contact policy; comprehensive refusal coverage is not claimed. A separate parity-tested correction must address the source policy and final database admission together.
