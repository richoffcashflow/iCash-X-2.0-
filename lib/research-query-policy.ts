export type ResearchQueryPolicy={version:'research-efficiency-v1';exclusionListId:string|null};
export const researchQueryPolicyValid=(v:unknown):v is ResearchQueryPolicy=>!!v&&typeof v==='object'&&(v as ResearchQueryPolicy).version==='research-efficiency-v1'&&((v as ResearchQueryPolicy).exclusionListId===null||typeof (v as ResearchQueryPolicy).exclusionListId==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test((v as ResearchQueryPolicy).exclusionListId!));
/** Match the existing call gate before purchasing more research. Unknown/positive
 * lien evidence on saved properties remains held; this never clears title. */
export const researchEligibilityFilters=()=>[
 {filter_id:'has_active_lien',value:false},{filter_id:'has_hoa_lien',value:false},{filter_id:'is_tax_delinquent',value:false},
 {filter_id:'num_total_active_liens',operator:'less_than_or_equal',value:0},
 {filter_id:'num_total_open_liens',operator:'less_than_or_equal',value:0},
 {filter_id:'total_open_lien_amount',operator:'less_than_or_equal',value:0},
];
