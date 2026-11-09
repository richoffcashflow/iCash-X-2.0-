/** Owner-selected formula: ARV × 70%, then deduct repairs and the wholesale fee. */
export const cashOfferPolicy=Object.freeze({version:'arv_70_less_repairs_v3',ruleBasisPoints:7000,largeDealArvCents:30000000,standardFeeCents:1000000,largeDealFeeCents:2000000});
const money=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
export function wholesaleFeeForArv(arvCents:number){
 if(!money(arvCents))throw Error('Invalid ARV');
 return arvCents>=cashOfferPolicy.largeDealArvCents?cashOfferPolicy.largeDealFeeCents:cashOfferPolicy.standardFeeCents;
}
export function cashOfferCalculation(arvCents:number|null,repairCents:number|null,options:{assignmentFeeCents?:number;ruleBasisPoints?:number}={}){
 if(!money(arvCents)||!money(repairCents))return null;
 const assignmentFeeCents=options.assignmentFeeCents??wholesaleFeeForArv(arvCents),ruleBasisPoints=options.ruleBasisPoints??cashOfferPolicy.ruleBasisPoints;
 if(!money(assignmentFeeCents)||!Number.isInteger(ruleBasisPoints)||ruleBasisPoints<=0||ruleBasisPoints>7000)throw Error('Invalid offer policy');
 const net=BigInt(arvCents)-BigInt(repairCents);
 // Integer cents; truncate only positive results so an offer is never rounded up.
 const discountedArv=BigInt(arvCents)*BigInt(ruleBasisPoints)/BigInt(10000),remaining=discountedArv-BigInt(repairCents);
 const buyer=remaining>BigInt(0)?remaining:BigInt(0),seller=buyer-BigInt(assignmentFeeCents);
 return {version:cashOfferPolicy.version,formula:`ARV × ${ruleBasisPoints/100}% - repairs - wholesale fee`,arvCents,repairCents,afterRepairsCents:Number(net),ruleBasisPoints,assignmentFeeCents,feePolicy:options.assignmentFeeCents===undefined?'arv_tiers_v1':'explicit',buyerCeilingCents:Number(buyer),sellerCeilingCents:seller>BigInt(0)?Number(seller):null};
}
