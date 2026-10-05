import {runScreeningJob} from './screening-job.ts';
export type SellerMarket={city:string;state:string;enabled:boolean;reviewed_until:string;review_ref:string};
export function qualifySellerProperty(raw:unknown,markets:SellerMarket[],options:{assignmentFeeCents:number;sellerCostReserveCents:number},now=Date.now()){
 const r=raw as {data?:Record<string,unknown>[];credits?:{used?:unknown;people?:unknown};totals?:{submitted?:number}};
 if(!Array.isArray(r?.data)||r.data.length!==1||r.totals?.submitted!==1||!Number.isSafeInteger(r.credits?.used)||Number(r.credits?.used)<0||Number(r.credits?.used)>1||r.credits?.people!==0)throw Error('PROVIDER_RESULT_REQUIRES_REVIEW');
 const row=r.data[0];if(row.matched===false)return {status:'unmatched' as const,numbersPassed:false,marketQualified:false,property:null,result:null,creditsUsed:Number(r.credits!.used)};
 if(row.matched!==true||row.match_warning||typeof row.dm_property_id!=='string'||typeof row.full_address!=='string'||row.property_type!==1)throw Error('PROPERTY_MATCH_REQUIRES_REVIEW');
 const fetchedAt=new Date(now).toISOString();const result=runScreeningJob({propertyId:row.dm_property_id,fetchedAt,propertyType:'house',raw:{data:row,credits:r.credits},...options},now);
 const numbersPassed=result.financialCheck.status==='eligible'&&typeof result.preliminarySellerCeilingCents==='number'&&result.preliminarySellerCeilingCents>0;
 const normalize=(v:unknown)=>typeof v==='string'?v.trim().toLowerCase():'';
 const marketQualified=numbersPassed&&markets.some(m=>m.enabled&&m.review_ref.trim()&&Date.parse(m.reviewed_until)>now&&normalize(m.city)===normalize(row.city)&&normalize(m.state)===normalize(row.state));
 return {status:marketQualified?'qualified' as const:numbersPassed?'market_review' as const:'numbers_review' as const,numbersPassed,marketQualified,property:{id:row.dm_property_id,city:row.city,state:row.state,zip:row.zip,address:row.full_address,fetchedAt,raw:{data:row,credits:r.credits}},result,creditsUsed:Number(r.credits!.used)};
}
/** A maximum bid is an eligibility ceiling, not the price charged to a customer. */
export function sellerLeadCharge(adCostMicros:number,otherCostMicros:number,multiplier=3){
 if(![adCostMicros,otherCostMicros,multiplier].every(Number.isSafeInteger)||adCostMicros<0||otherCostMicros<0||multiplier!==3)throw Error('LEAD_COST_REQUIRED');
 const amount=(BigInt(adCostMicros)+BigInt(otherCostMicros))*BigInt(multiplier);const cents=(amount+BigInt(9999))/BigInt(10000);if(cents>BigInt(Number.MAX_SAFE_INTEGER))throw Error('LEAD_COST_TOO_LARGE');return Number(cents);
}
export function sellerLeadEvent(stage:'numbers_passed'|'market_qualified'|'call_connected'|'application_submitted'){return ({numbers_passed:'CompleteRegistration',market_qualified:'Lead',call_connected:'Contact',application_submitted:'SubmitApplication'} as const)[stage];}
