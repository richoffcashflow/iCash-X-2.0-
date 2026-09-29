/** Duration of a prepaid daily-budget selection; not a recurring charge. */
export function maximumFundingDays(priceCents:number){
 if(!Number.isSafeInteger(priceCents)||priceCents<1000)throw new Error('Minimum daily budget is $10');
 return 7;
}
