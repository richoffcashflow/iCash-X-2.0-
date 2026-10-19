// Shared, provider-independent allowlist. Never expose arbitrary provider/RPC text.
export const recordingGateHoldReasons=['not_gate_only','gate_entry_policy_required','terminal_carrier_receipt_required','terminal_carrier_price_pending','terminal_carrier_price_invalid','reviewed_costs_required','terminal_carrier_settlement_rejected'] as const;
export type RecordingGateHoldReason=typeof recordingGateHoldReasons[number];
export function recordingGateCostPending(reason:unknown,lastAction:unknown):boolean{
 return lastAction!=='gate_settled'&&typeof reason==='string'&&(reason==='terminal_carrier_reconciliation_required'||recordingGateHoldReasons.some(code=>code===reason));
}
