export type ResearchQueryPolicy={version:'research-efficiency-v1'|'research-efficiency-v2';exclusionListId:string|null};
export const researchQueryPolicyValid=(v:unknown):v is ResearchQueryPolicy=>!!v&&typeof v==='object'&&['research-efficiency-v1','research-efficiency-v2'].includes((v as ResearchQueryPolicy).version)&&((v as ResearchQueryPolicy).exclusionListId===null||typeof (v as ResearchQueryPolicy).exclusionListId==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test((v as ResearchQueryPolicy).exclusionListId!));
/** Optional numeric lien fields are NULL on observed eligible records. A SQL-like
 * <=0 filter silently removes those records. Keep numeric evidence in the existing
 * financial screen; this query never establishes clear title or changes a hold.
 * Retain v1 exactly for original in-flight query identities. */
export const researchEligibilityFilters=(version:ResearchQueryPolicy['version'])=>[
 {filter_id:'has_active_lien',value:false},{filter_id:'has_hoa_lien',value:false},{filter_id:'is_tax_delinquent',value:false},
 ...(version==='research-efficiency-v1'?[
 {filter_id:'num_total_active_liens',operator:'less_than_or_equal',value:0},
 {filter_id:'num_total_open_liens',operator:'less_than_or_equal',value:0},
 {filter_id:'total_open_lien_amount',operator:'less_than_or_equal',value:0},
 ]:[]),
];
