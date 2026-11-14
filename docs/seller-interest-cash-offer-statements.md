# Explicit seller-interest statements

The November 14 read-only audit found a recognition gap: the shared call parser accepted an exact first-person selling declaration, but rejected an equally explicit cash-offer declaration and declarations accompanied by a price question in the same turn.

The TypeScript and SQL readers now share one anchored pattern for first-person selling or cash-offer interest. A bounded question such as “What can you offer?” may precede or follow the declaration. The question alone, “depends on the offer,” ownership confirmation, conditional interest, quoted third-party speech and references to another property remain insufficient.

Whole-call refusal, opt-out, automated-answer and no-response exclusions stay authoritative. The actual audited compound cash-offer statement ended in an opt-out; it remains a negative outcome. The read-only comparison over 4,862 completed non-owner seller calls in the prior 14 days found three positives under both the old and proposed readers, with zero added positives. This correction prepares future evidence recognition; it does not establish recovered historical sellers or improved conversion.

The guarded forward migration changes only the private clear-transcript parser's explicit-statement pattern. It preserves the current function attributes, source receipts, public wrapper, model qualification and all financial/contact authority. Existing bounded learning refreshes can read the new parser; the migration does not replay conversations or rewrite original transcripts.

Validation: `tests/seller-interest-cash-offer-statements.test.mjs` runs the exact production predecessor, rejects unreviewed drift atomically, verifies SQL/TypeScript/provider parity, whole-call opt-out/refusal exclusions, immutable input, permissions and idempotent replay. The existing 43-case `seller-interest-evidence.test.mjs` also passes. All checks are offline except the aggregate, read-only comparison.
