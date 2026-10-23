// These outcomes did not produce a new customer milestone. Dedicated billing
// and notification schedules still run; do not repeat their scans on idle work.
export function automationChanged(status:string){
 return !new Set(['supply_target_met','updates_disabled','updates_idle','updates_held',
  'attention_disabled','attention_idle','attention_held','waiting_for_daytime_budget',
  'waiting_for_available_credits','seller_inventory_unavailable','waiting_for_active_call','outside_contact_hours','empty','awaiting_conversation',
  'awaiting_counterparty','customer_signature_needed']).has(status);
}
