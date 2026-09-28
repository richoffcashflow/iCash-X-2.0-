/** USD micros preserve sub-cent costs. Explicit zero means verified not applicable, not unknown. */
export const costCategories=['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other'] as const;
export type CostQuote={rateVersion:string;checkedAt:number;expiresAt:number;amountsMicros:Record<typeof costCategories[number],number|null>;bufferBasisPoints:number};
export function fullCostReserve(quote:CostQuote|undefined,now:number){
 if(!quote||!quote.rateVersion?.trim()||!Number.isFinite(quote.checkedAt)||!Number.isFinite(quote.expiresAt)||quote.checkedAt>now||quote.expiresAt<=now||quote.expiresAt<=quote.checkedAt)return {ok:false as const,reason:'missing or expired full cost quote'};
 if(!Number.isInteger(quote.bufferBasisPoints)||quote.bufferBasisPoints<0||quote.bufferBasisPoints>10000)return {ok:false as const,reason:'invalid cost buffer'};
 let total=BigInt(0);
 for(const category of costCategories){const n=quote.amountsMicros?.[category];if(typeof n!=='number'||!Number.isSafeInteger(n)||n<0)return {ok:false as const,reason:`unknown cost: ${category}`};total+=BigInt(n);}
 // Round UP after adding a separately visible buffer; never round tiny costs down to zero.
 const numerator=total*BigInt(10000+quote.bufferBasisPoints),denominator=BigInt(100000000);
 const reserve=(numerator+denominator-BigInt(1))/denominator;
 if(reserve>BigInt(Number.MAX_SAFE_INTEGER)||total>BigInt(Number.MAX_SAFE_INTEGER))return {ok:false as const,reason:'cost exceeds safe range'};
 return {ok:true as const,reserveCents:Number(reserve),estimatedTotalMicros:Number(total),rateVersion:quote.rateVersion};
}
