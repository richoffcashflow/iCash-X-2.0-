import {receptionReceiptProfile, type ReceptionDeps} from './general-reception.ts';

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const identifier = (value: unknown) => typeof value === 'string' && value.length > 0;

/** Internal server attestation. It must only be built AFTER authenticated,
 * exact-bound canonical provider GETs and successful receipt completion.
 * Provider credentials/raw payloads are never passed to the database. */
export function receptionCostAttestation(receipt: Record<string, unknown>, conversationId: string, durationSeconds: number, costs: Record<string, unknown>) {
  if (!receptionReceiptProfile(receipt) || !identifier(receipt.receipt_id) || !hash(receipt.config_hash) || !hash(receipt.receipt_nonce)
    || !identifier(conversationId) || !Number.isFinite(durationSeconds) || durationSeconds < 0
    || durationSeconds > Number(receipt.max_duration_seconds) + 2
    || !integer(costs.twilioUsdMicros) || !integer(costs.elevenLabsUsdMicros)
    || !hash(costs.twilioReceiptHash) || !hash(costs.elevenLabsReceiptHash)) return null;
  return {
    schemaVersion: 1,
    binding: {
      receiptId: receipt.receipt_id, operationKey: receipt.operation_key, accountId: receipt.account_id,
      callSid: receipt.call_sid, receiptNonce: receipt.receipt_nonce, configHash: receipt.config_hash,
      agentId: receipt.agent_id, branchId: receipt.branch_id, versionId: receipt.reviewed_version_id,
      conversationId, callProfile: receipt.call_profile, rateId: receipt.rate_id,
      maxDurationSeconds: receipt.max_duration_seconds, customerChargeCapCents: receipt.customer_charge_cap_cents,
    },
    durationSeconds,
    providers: {
      twilio: {currency: 'USD', amountMicros: costs.twilioUsdMicros, receiptHash: costs.twilioReceiptHash},
      elevenlabs: {currency: 'USD', amountMicros: costs.elevenLabsUsdMicros, receiptHash: costs.elevenLabsReceiptHash},
    },
  };
}

/** Recover an earlier committed settlement without refetching mutable provider
 * metadata. This never authorizes a new charge. The database cross-checks the
 * immutable review, manifest, operation and credit reservation. */
export async function readReviewedReceptionSettlement(receipt: Record<string, unknown>, deps: ReceptionDeps, signal: AbortSignal) {
  if (!identifier(receipt.receipt_id)) return null;
  try {
    const result = object(await deps.rpc('icash_get_general_reception_settlement', {p_operation: receipt.operation_key}, signal));
    if (result.settled !== true || !integer(result.chargedCents) || result.chargedCents > Number(receipt.customer_charge_cap_cents)
      || !['verified', 'estimated'].includes(String(result.costBasis))) return null;
    return {settled: true as const, chargedCents: result.chargedCents, costBasis: result.costBasis as 'verified' | 'estimated',
      allInCostVerified: result.costBasis === 'verified', providerMarginVerified: result.costBasis === 'verified' && result.providerMarginVerified === true};
  } catch { return null; }
}

/** No service-role or model path can create an approval. The private database
 * review must already contain the exact attestation AND all 16 reviewed costs.
 * Missing migration, unknown cost, or missing review keeps the reserve held. */
export async function settleReviewedReception(receipt: Record<string, unknown>, conversationId: string, durationSeconds: number, costs: Record<string, unknown>, deps: ReceptionDeps, signal: AbortSignal) {
  const attestation = receptionCostAttestation(receipt, conversationId, durationSeconds, costs);
  if (!attestation) return {settled: false as const, settlementReason: 'provider_costs_or_binding_unknown'};
  try {
    const result = object(await deps.rpc('icash_settle_general_reception', {p_operation: receipt.operation_key, p_attestation: attestation}, signal));
    if (result.settled !== true && result.settled !== false) return {settled: null, settlementReason: 'settlement_status_unconfirmed'};
    if (result.settled === false) return {settled: false as const, settlementReason: typeof result.reason === 'string' && ['cost_review_required', 'cost_review_mismatch', 'charge_exceeds_cap', 'receipt_not_terminal', 'operation_not_dispatched', 'reservation_mismatch'].includes(result.reason) ? result.reason : 'settlement_held'};
    if (!integer(result.chargedCents) || result.chargedCents > Number(receipt.customer_charge_cap_cents)
      || !['verified', 'estimated'].includes(String(result.costBasis))) return {settled: null, settlementReason: 'settlement_status_unconfirmed'};
    return {settled: true as const, chargedCents: result.chargedCents, costBasis: result.costBasis as 'verified' | 'estimated',
      allInCostVerified: result.costBasis === 'verified', providerMarginVerified: result.costBasis === 'verified' && result.providerMarginVerified === true};
  } catch {
    // Never claim the reserve is held after an ambiguous write: the transaction
    // may have committed. Exact same input is safe to retry; no compensating refund.
    return {settled: null, settlementReason: 'settlement_status_unconfirmed'};
  }
}
