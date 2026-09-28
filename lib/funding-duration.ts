/** Minimum planning pace: $100 per 30 days. This is not a recurring charge. */
export function maximumFundingDays(priceCents:number){
 if(!Number.isSafeInteger(priceCents)||priceCents<2000)throw new Error('Minimum funding is $20');
 return Math.min(30,Math.floor(priceCents*30/10000));
}
