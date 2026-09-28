import {runScreeningJob} from './screening-job.ts';
type Input={snapshot:unknown;creditCap:number;unitCostMicros:number;quotedDataCostMicros:number};
export async function enrichOwners(i:Input,d:{reserveAndClaim:()=>Promise<boolean>;fetchOwners:(id:string)=>Promise<unknown>;persist:(r:OwnerResult)=>Promise<void>},now=Date.now()){
 const screening=runScreeningJob(i.snapshot,now);
 if(screening.financialCheck.status!=='eligible')return {status:'financial_hold'};
 if(![i.creditCap,i.unitCostMicros,i.quotedDataCostMicros].every(n=>Number.isSafeInteger(n)&&n>0)||i.creditCap>25||BigInt(i.creditCap)*BigInt(i.unitCostMicros)>BigInt(i.quotedDataCostMicros))throw new Error('CONTACT_RATE_REQUIRED');
 if(!await d.reserveAndClaim())return {status:'held'};
 // Documented GET returns owner contacts; no server-side contact cap or estimate is documented.
 // CreditCap is an approved reservation allowance, NOT a vendor-enforced cap. Record any overrun.
 const raw=await d.fetchOwners(screening.property.propertyId) as {data?:{dm_property_id?:string;contacts?:unknown[]};credits?:{used?:number;people?:number}};
 if(raw?.data?.dm_property_id!==screening.property.propertyId||!Array.isArray(raw.data.contacts)||raw.data.contacts.length>100||![raw.credits?.used,raw.credits?.people].every(n=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0))throw new Error('CONTACT_RECEIPT_REQUIRES_RECONCILIATION');
 const contacts=raw.data.contacts.map(v=>{
  const p=v as Record<string,unknown>;
  if(!p||typeof p.dm_person_id!=='string'||!/^per_[a-zA-Z0-9]+$/.test(p.dm_person_id))throw new Error('CONTACT_RESPONSE_INVALID');
  const phones=Array.isArray(p.phones)?p.phones.slice(0,20).map(v=>{const x=v as Record<string,unknown>;return {number:typeof x?.number==='string'?x.number.slice(0,30):null,doNotCall:typeof x?.do_not_call==='boolean'?x.do_not_call:null,type:typeof x?.type==='string'?x.type.slice(0,30):null,permission:'unverified'};}):[];
  const emails=Array.isArray(p.emails)?p.emails.slice(0,20).map(v=>{const x=v as Record<string,unknown>;return typeof x?.address==='string'?x.address.slice(0,320):null;}).filter(Boolean):[];
  return {personId:p.dm_person_id,name:typeof p.full_name==='string'?p.full_name.slice(0,200):null,likelyOwner:p.is_likely_owner===true,phones,emails,outreachAuthorized:false};
 });
 const result:OwnerResult={propertyId:screening.property.propertyId,creditsUsed:raw.credits!.used!,peopleCredits:raw.credits!.people!,contacts,outreachAuthorized:false,fetchedAt:new Date(now).toISOString()};
 await d.persist(result);
 return {status:result.creditsUsed>i.creditCap?'needs_reconciliation':'contacts_saved',contacts:contacts.length};
}
export type OwnerResult={propertyId:string;creditsUsed:number;peopleCredits:number;contacts:unknown[];outreachAuthorized:false;fetchedAt:string};
