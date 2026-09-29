import fees from '@/config/funding-fees.json';
export const processingFeePercent=fees.processingFeeBasisPoints/100;
export function processingFeeCents(budgetCents:number){
 if(!Number.isSafeInteger(budgetCents)||budgetCents<0)throw new Error('Invalid budget');
 return Math.round(budgetCents*fees.processingFeeBasisPoints/10000);
}
