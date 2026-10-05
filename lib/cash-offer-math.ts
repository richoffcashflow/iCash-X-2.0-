/** Owner-selected formula. Repairs are deducted BEFORE the 70% multiplier. */
export const cashOfferPolicy=Object.freeze({version:'net_after_repairs_70_v2',ruleBasisPoints:7000,largeDealArvCents:30000000,standardFeeCents:1000000,largeDealFeeCents:2000000});
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
 const buyer=net>BigInt(0)?net*BigInt(ruleBasisPoints)/BigInt(10000):BigInt(0),seller=buyer-BigInt(assignmentFeeCents);
 return {version:cashOfferPolicy.version,formula:`(ARV - repairs) × ${ruleBasisPoints/100}% - wholesale fee`,arvCents,repairCents,afterRepairsCents:Number(net),ruleBasisPoints,assignmentFeeCents,feePolicy:options.assignmentFeeCents===undefined?'arv_tiers_v1':'explicit',buyerCeilingCents:Number(buyer),sellerCeilingCents:seller>BigInt(0)?Number(seller):null};
}
