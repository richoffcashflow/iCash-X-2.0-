/** Inputs must cover one reconciled period. Costs exclude marketing, interest and D&A supplied separately. */
export type OwnerProfitInput={
 earnedRevenueCents:number|null;operatingCostsCents:number|null;marketingCostsCents:number|null;
 interestCents:number|null;depreciationAmortizationCents:number|null;
 clearedCashCents:number|null;unspentCustomerFundsCents:number|null;
 unpaidBillsAndCommitmentsCents:number|null;protectedCashCents:number|null;
 priorOwnerDrawsCents:number|null;taxReserveBasisPoints:number;
};
export function ownerProfit(i:OwnerProfitInput){
 if(!Number.isInteger(i.taxReserveBasisPoints)||i.taxReserveBasisPoints<0||i.taxReserveBasisPoints>10000)throw new Error('Invalid tax reserve');
 const entries=Object.entries(i).filter(([k])=>k!=='taxReserveBasisPoints');
 if(entries.some(([,v])=>v===null))return {status:'needs_reconciliation' as const,estimatedAvailableCents:null};
 if(entries.some(([,v])=>!Number.isSafeInteger(v)||v!<0))throw new Error('Invalid financial amounts');
 const b=(v:number|null)=>BigInt(v!);
 const ebitda=b(i.earnedRevenueCents)-b(i.operatingCostsCents)-b(i.marketingCostsCents);
 const pretax=ebitda-b(i.interestCents)-b(i.depreciationAmortizationCents);
 const tax=pretax>BigInt(0)?(pretax*BigInt(i.taxReserveBasisPoints)+BigInt(9999))/BigInt(10000):BigInt(0);
 const profitLimit=pretax-tax-b(i.priorOwnerDrawsCents);
 // Each cash obligation is counted once; protected cash includes capital/debt, sales tax and contingency reserves, excluding the tax reserve calculated above.
 const cashLimit=b(i.clearedCashCents)-b(i.unspentCustomerFundsCents)-b(i.unpaidBillsAndCommitmentsCents)-b(i.protectedCashCents)-tax;
 const available=profitLimit<cashLimit?profitLimit:cashLimit;
 if([ebitda,pretax,tax,available].some(v=>v>BigInt(Number.MAX_SAFE_INTEGER)||v< -BigInt(Number.MAX_SAFE_INTEGER)))throw new Error('Financial total exceeds safe range');
 return {status:'estimated' as const,ebitdaCents:Number(ebitda),preTaxProfitCents:Number(pretax),taxReserveCents:Number(tax),estimatedAvailableCents:Number(available>BigInt(0)?available:BigInt(0)),taxReserveBasisPoints:i.taxReserveBasisPoints};
}
