/** Duration of a prepaid daily-budget selection; not a recurring charge. */
export function maximumFundingDays(priceCents:number){
 if(!Number.isSafeInteger(priceCents)||priceCents<2000)throw new Error('Minimum daily budget is $20');
 return 7;
}
