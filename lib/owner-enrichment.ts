import {runScreeningJob} from './screening-job.ts';

type Input={snapshot:unknown;creditCap:number;unitCostMicros:number;quotedDataCostMicros:number};
type Credits={used:number;people:number;properties:number;deduplicated:number};
export type OwnerCreditObservation={used:number|null;people:number|null;properties:number|null;deduplicated:number|null};
type Dependencies={
 previewOwners:(propertyId:string)=>Promise<unknown>;
 reserveAndClaim:()=>Promise<boolean>;
 fetchPeople:(ids:readonly string[])=>Promise<unknown>;
 recordReceipt:(receipt:OwnerCreditObservation)=>Promise<void>;
 persist:(result:OwnerResult)=>Promise<void>;
};
const record=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const personId=(v:unknown):v is string=>typeof v==='string'&&/^per_[a-zA-Z0-9]{1,100}$/.test(v);
const flag=(v:unknown)=>typeof v==='boolean'?v:null;
function creditObservation(raw:unknown):OwnerCreditObservation{
 const credits=record(raw)&&record(raw.credits)?raw.credits:{};
 return {used:integer(credits.used)?credits.used:null,people:integer(credits.people)?credits.people:null,
  properties:integer(credits.properties)?credits.properties:null,deduplicated:integer(credits.deduplicated)?credits.deduplicated:null};
}
function requireCredits(raw:unknown,error:string):Credits{
 const c=creditObservation(raw);
 if(c.used===null||c.people===null||c.properties===null||c.deduplicated===null)throw new Error(error);
 return c as Credits;
}
/** Free preview IDs are the only allowable paid audience; names are never rematched. */
function previewAudience(raw:unknown,propertyId:string,cap:number){
 const error='CONTACT_PREVIEW_INVALID';
 const credits=requireCredits(raw,error);
 if(credits.used!==0||credits.properties!==0||credits.people!==0||credits.deduplicated!==0||!record(raw)||!record(raw.data)||raw.data.dm_property_id!==propertyId||!Array.isArray(raw.data.contacts))throw new Error(error);
 const owners=new Map<string,{likelyOwner:boolean;matchFlags:Record<string,boolean|null>}>();
 for(const p of raw.data.contacts){
  // Validate the whole preview, including rows beyond the cap, before reserving money.
  if(!record(p)||!personId(p.dm_person_id))throw new Error(error);
  const matchFlags={is_likely_owner:flag(p.is_likely_owner),is_in_owner_family:flag(p.is_in_owner_family),is_resident:flag(p.is_resident),is_likely_renter:flag(p.is_likely_renter)};
  const prior=owners.get(p.dm_person_id);
  if(prior&&JSON.stringify(prior.matchFlags)!==JSON.stringify(matchFlags))throw new Error(error);
  if(!prior)owners.set(p.dm_person_id,{likelyOwner:p.is_likely_owner===true,matchFlags});
 }
 const ids=Object.freeze([...owners.keys()].slice(0,cap));
 return {ids,owners};
}
function contactsFromReceipt(raw:unknown,ids:readonly string[],owners:ReturnType<typeof previewAudience>['owners']){
 const error='CONTACT_RECEIPT_REQUIRES_RECONCILIATION';
 const credits=requireCredits(raw,error);
 if(!record(raw)||!Array.isArray(raw.data)||raw.data.length!==ids.length||!record(raw.totals))throw new Error(error);
 const requested=new Set(ids),seen=new Set<string>();
 const contacts=[];
 for(const p of raw.data){
  if(!record(p)||!personId(p.dm_person_id)||!requested.has(p.dm_person_id)||seen.has(p.dm_person_id)||typeof p.found!=='boolean'||p.error!==undefined||p.property!==undefined||p.properties!==undefined)throw new Error(error);
  seen.add(p.dm_person_id);
  if(!p.found)continue;
  const phones=Array.isArray(p.phones)?p.phones.slice(0,20).map(v=>{
   const x=record(v)?v:{};
   return {number:typeof x.number==='string'?x.number.slice(0,30):null,doNotCall:flag(x.do_not_call),type:typeof x.type==='string'?x.type.slice(0,30):null,permission:'unverified'};
  }):[];
  const emails=Array.isArray(p.emails)?p.emails.slice(0,20).map(v=>record(v)&&typeof v.address==='string'?v.address.slice(0,320):null).filter((v):v is string=>v!==null):[];
  const association=owners.get(p.dm_person_id)!;
  contacts.push({personId:p.dm_person_id,name:typeof p.full_name==='string'?p.full_name.slice(0,200):null,
   likelyOwner:association.likelyOwner,matchFlags:association.matchFlags,ownershipVerified:false,phones,emails,outreachAuthorized:false});
 }
 const found=contacts.length;
 if(raw.totals.submitted!==ids.length||raw.totals.found!==found||raw.totals.not_found!==ids.length-found||credits.properties!==0||credits.people!==found||credits.used>found||credits.deduplicated>found||credits.used+credits.deduplicated!==found)throw new Error(error);
 return {contacts,credits};
}
export async function enrichOwners(i:Input,d:Dependencies,now=Date.now()){
 const screening=runScreeningJob(i.snapshot,now);
 if(screening.financialCheck.status!=='eligible')return {status:'financial_hold'};
 // The unit price is the operator's planning allocation, never a claimed vendor invoice rate.
 if(![i.creditCap,i.unitCostMicros,i.quotedDataCostMicros].every(n=>Number.isSafeInteger(n)&&n>0)||i.creditCap>25||BigInt(i.creditCap)*BigInt(i.unitCostMicros)>BigInt(i.quotedDataCostMicros))throw new Error('CONTACT_RATE_REQUIRED');
 const {ids,owners}=previewAudience(await d.previewOwners(screening.property.propertyId),screening.property.propertyId,i.creditCap);
 if(ids.length===0)return {status:'empty',contacts:0};
 if(!await d.reserveAndClaim())return {status:'held'};
 // One fixed ID set, one paid request. A timeout or invalid receipt must never trigger a replay.
 const raw=await d.fetchPeople(ids);
 // Preserve actual credit evidence even when the paid response fails validation.
 await d.recordReceipt(creditObservation(raw));
 const {contacts,credits}=contactsFromReceipt(raw,ids,owners);
 const result:OwnerResult={propertyId:screening.property.propertyId,creditsUsed:credits.used,peopleCredits:credits.people,
  providerCredits:credits,requestedPersonIds:[...ids],contacts,outreachAuthorized:false,fetchedAt:new Date(now).toISOString()};
 await d.persist(result);
 return {status:'contacts_saved',contacts:contacts.length};
}
export type OwnerResult={propertyId:string;creditsUsed:number;peopleCredits:number;contacts:unknown[];outreachAuthorized:false;fetchedAt:string;providerCredits:Credits;requestedPersonIds:string[]};
