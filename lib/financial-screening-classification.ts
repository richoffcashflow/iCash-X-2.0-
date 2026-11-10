type FinancialResult={property:{arvEstimate:{cents:number|null};repairs:{baselineCents:number|null;estimateStatus:string};financialScreening:{status:string;estimatedLoanBalanceCents:number|null;equityMinimum:{eligible:boolean;percent:number|null}}};financialCheck:{status:string;reason:string};preliminarySellerCeilingCents:number|null};
export type ScreeningCategory='qualified'|'financial_rejection'|'missing_financial_information'|'technical_failure'|'inconsistent_financial_calculation';
/** Diagnostic classification only. Never replaces financial or contact admission. */
export function classifyFinancialScreening(result:FinancialResult,snapshot:unknown):{category:ScreeningCategory;code:string}{
 const s=snapshot as {propertyType?:string;sellerCostReserveCents?:number;raw?:{data?:Record<string,unknown>}};
 const p=result.property,f=p.financialScreening,d=s?.raw?.data??{};
 const answer=(category:ScreeningCategory,code:string)=>({category,code});
 if(f.status==='conflicting_data'||p.repairs.estimateStatus==='invalid'
  ||['estimated_value','total_estimated_loan_balance'].some(k=>d[k]!=null&&(typeof d[k]!=='number'||!Number.isFinite(d[k])||(d[k] as number)<0))
  ||d.estimated_equity_percentage!=null&&(typeof d.estimated_equity_percentage!=='number'||!Number.isFinite(d.estimated_equity_percentage)||(d.estimated_equity_percentage as number)>100))
  return answer('inconsistent_financial_calculation','invalid_or_conflicting_provider_estimate');
 if(result.financialCheck.status==='eligible')return answer('qualified','preliminary_estimates_only');
 if(s.propertyType!=='house')return answer('financial_rejection','separate_property_underwriting');
 if(p.arvEstimate.cents===null||p.repairs.baselineCents===null)return answer('missing_financial_information','value_or_repairs_missing');
 if(f.equityMinimum.percent===null)return answer('missing_financial_information','equity_missing');
 if(!f.equityMinimum.eligible)return answer('financial_rejection','equity_below_minimum');
 if(result.preliminarySellerCeilingCents===null||result.preliminarySellerCeilingCents<=0)return answer('financial_rejection','no_positive_offer_after_repairs_and_fee');
 if(f.estimatedLoanBalanceCents===null)return answer('missing_financial_information','debt_missing');
 if(s.sellerCostReserveCents===undefined)return answer('missing_financial_information','closing_reserve_missing');
 if(f.estimatedLoanBalanceCents>=result.preliminarySellerCeilingCents-s.sellerCostReserveCents)return answer('financial_rejection','estimated_debt_exceeds_net_offer');
 if(f.status==='title_review_needed')return answer('missing_financial_information','lien_tax_payoff_verification');
 return answer('missing_financial_information','verification_required');
}
