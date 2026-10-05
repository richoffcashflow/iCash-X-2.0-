export type SellerDemandStats={activeAccounts:number;budgetAvailableAccounts:number;accountsWithoutLead24h:number;deliveries24h:number;deliveries7d:number;qualified7d:number;requests7d:number;scheduledLeads24h:number;matureLeads:number;observedRecipientsPerLead:number|null};
/** Minimum uses all eight slots. Planning uses observed completed cohorts only. */
export function sellerDemandPlan(s:SellerDemandStats){
 const daily=s.activeAccounts,weekly=daily*7,slots=Math.max(1,Math.min(8,daily));
 const observed=s.matureLeads>=10&&s.observedRecipientsPerLead!==null&&s.observedRecipientsPerLead>0?Math.min(slots,s.observedRecipientsPerLead):null;
 return {...s,dailyDeliveryTarget:daily,weeklyDeliveryTarget:weekly,minimumQualifiedDaily:Math.ceil(daily/slots),minimumQualifiedWeekly:Math.ceil(weekly/slots),plannedQualifiedDaily:observed?Math.ceil(daily/observed):null,plannedQualifiedWeekly:observed?Math.ceil(weekly/observed):null,observedYield:observed,shortfall24h:s.accountsWithoutLead24h};
}
export type SellerDemandPlan=ReturnType<typeof sellerDemandPlan>;
