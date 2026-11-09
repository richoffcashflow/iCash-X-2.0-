import {buyerContactObservations,type BuyerPhoneObservation,type BuyerEmailObservation} from './buyer-contact-quality.ts';
export type BuyerSearchStrategy='recent_corporate'|'corporate_owners';
export type BuyerSearch={zip:string;page:number;perPage:number;since:string;unitCostMicros:number;quotedCostMicros:number;strategy?:BuyerSearchStrategy};
export type BuyerSearchReceipt={page:number;has_next_page:boolean;receipt?:{strategy?:string;providerPage?:number;learningVersion?:string;firstStrategy?:string}};
/** Use only complete, immutable shared-search history. Legacy unlabelled pages
 * retain their old cursor rather than inventing which provider pages they used. */
export function nextBuyerSearchFromReceipts(receipts:BuyerSearchReceipt[],maxPages:number,firstStrategy?:BuyerSearchStrategy){
 if(!Number.isInteger(maxPages)||maxPages<1||maxPages>5||!Array.isArray(receipts)||receipts.length>5)throw Error('BUYER_CURSOR_REVIEW_REQUIRED');
 if(!firstStrategy)return nextBuyerSearch(receipts.at(-1),maxPages);
 if(!['recent_corporate','corporate_owners'].includes(firstStrategy))throw Error('BUYER_CURSOR_REVIEW_REQUIRED');
 const second:BuyerSearchStrategy=firstStrategy==='recent_corporate'?'corporate_owners':'recent_corporate';
 const latest=new Map<BuyerSearchStrategy,BuyerSearchReceipt>();
 for(const [index,row] of receipts.entries()){
  const r=row.receipt,strategy=r?.strategy as BuyerSearchStrategy,prior=latest.get(strategy);
  if(row.page!==index+1||typeof row.has_next_page!=='boolean'||r?.learningVersion!=='shared-v1'||r.firstStrategy!==firstStrategy
   ||!['recent_corporate','corporate_owners'].includes(strategy)||!Number.isInteger(r.providerPage)||r.providerPage!==((prior?.receipt?.providerPage??0)+1)
   ||prior&&!prior.has_next_page||index===0&&strategy!==firstStrategy||index===1&&strategy!==second)throw Error('BUYER_CURSOR_REVIEW_REQUIRED');
  latest.set(strategy,row);
 }
 if(receipts.length>=maxPages)return null;
 if(!receipts.length)return {page:1,providerPage:1,strategy:firstStrategy};
 if(receipts.length===1)return {page:2,providerPage:1,strategy:second};
 // Keep the existing second-strategy order; resume the first only when the
 // second is exhausted and its own last receipt explicitly has another page.
 const strategy=latest.get(second)?.has_next_page?second:latest.get(firstStrategy)?.has_next_page?firstStrategy:null;
 return strategy?{page:receipts.length+1,providerPage:latest.get(strategy)!.receipt!.providerPage!+1,strategy}:null;
}
export function nextBuyerSearch(last:{page:number;has_next_page:boolean;receipt?:{strategy?:string;providerPage?:number;learningVersion?:string;firstStrategy?:string}}|undefined,maxPages:number,firstStrategy?:BuyerSearchStrategy){
 if(last&&last.page>=maxPages)return null;
 if(firstStrategy){
  const second:BuyerSearchStrategy=firstStrategy==='recent_corporate'?'corporate_owners':'recent_corporate';
  if(!last)return {page:1,providerPage:1,strategy:firstStrategy};
  if(last.receipt?.learningVersion!=='shared-v1'||last.receipt.firstStrategy!==firstStrategy)throw Error('BUYER_CURSOR_REVIEW_REQUIRED');
  if(last.page===1)return {page:2,providerPage:1,strategy:second};
  if(!last.has_next_page)return null;
  if(last.receipt.strategy!==second||!Number.isSafeInteger(last.receipt.providerPage)||Number(last.receipt.providerPage)<1)throw Error('BUYER_CURSOR_REVIEW_REQUIRED');
  return {page:last.page+1,providerPage:Number(last.receipt.providerPage)+1,strategy:second};
 }
 if(!last)return {page:1,providerPage:1,strategy:'recent_corporate' as const};
 // One focused page first, then a broader corporate-owner pool. Ownership is
 // a prospect signal, never proof of cash funds or permission to contact.
 if(last.receipt?.strategy!=='corporate_owners')return {page:last.page+1,providerPage:1,strategy:'corporate_owners' as const};
 if(!last.has_next_page)return null;
 const providerPage=last.receipt.providerPage;
 if(!Number.isSafeInteger(providerPage)||Number(providerPage)<1)throw Error('BUYER_CURSOR_REVIEW_REQUIRED');
 return {page:last.page+1,providerPage:Number(providerPage)+1,strategy:'corporate_owners' as const};
}
const integer=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
export function buyerSearchBody(i:BuyerSearch){
 if(!/^\d{5}$/.test(i.zip)||!integer(i.page)||i.page<1||!integer(i.perPage)||i.perPage<1||i.perPage>10||!/^\d{4}-\d{2}-\d{2}$/.test(i.since)||!integer(i.unitCostMicros)||i.unitCostMicros===0||!integer(i.quotedCostMicros))throw Error('BUYER_SEARCH_CONFIG_REQUIRED');
 if(i.strategy!==undefined&&!['recent_corporate','corporate_owners'].includes(i.strategy))throw Error('BUYER_SEARCH_CONFIG_REQUIRED');
 return {locations:[{type:'zip_code',code:i.zip}],anchor:'people',contact_audience:'owners',fields:['full_address'],filters:[{filter_id:'is_corporate_owned',value:true},...(i.strategy==='corporate_owners'?[]:[{filter_id:'num_mortgages',operator:'equals',value:0},{filter_id:'last_sale_date',operator:'is_after',value:i.since}])],page:i.page,per_page:i.perPage};
}
export type BuyerDiscoveryResult={creditsUsed:number;peopleCredits:number;propertyCredits:number;estimatedCredits:number;hasNextPage:boolean;fetchedAt:string;candidates:{personId:string;name:string;propertyId:string;propertyAddress:string;phones:BuyerPhoneObservation[];emails:string[];emailObservations:BuyerEmailObservation[];contactSource:'dealmachine';contactObservedAt:string;contactQualityVersion:'buyer-contacts-v1'}[]};
export async function discoverBuyerPage(i:BuyerSearch,d:{request:(body:object)=>Promise<unknown>;claim:()=>Promise<boolean>;persist:(result:BuyerDiscoveryResult)=>Promise<void>;empty?:()=>Promise<void>}){
 const body=buyerSearchBody(i);
 const estimate=await d.request({...body,estimate_cost:true}) as {estimated_credits?:{this_page?:unknown;breakdown?:{properties?:unknown;people?:unknown}}};
 const c=estimate?.estimated_credits;
 if(!integer(c?.this_page)||!integer(c?.breakdown?.people)||c?.breakdown?.properties!==0||c.this_page>i.perPage||c.breakdown.people>i.perPage)throw Error('BUYER_COST_ESTIMATE_INVALID');
 if(c.this_page===0){await d.empty?.();return {status:'no_candidates',canContinue:false};}
 if(BigInt(c.this_page)*BigInt(i.unitCostMicros)>BigInt(i.quotedCostMicros))throw Error('BUYER_COST_QUOTE_TOO_LOW');
 if(!await d.claim())return {status:'held',canContinue:false};
 const r=await d.request({...body,estimate_cost:false}) as {data?:Record<string,unknown>[];credits?:{used?:number;people?:number;properties?:number};pagination?:{has_next_page?:boolean}};
 if(!Array.isArray(r?.data)||r.data.length>i.perPage||!integer(r.credits?.used)||!integer(r.credits?.people)||!integer(r.credits?.properties)||typeof r.pagination?.has_next_page!=='boolean')throw Error('BUYER_RECEIPT_NEEDS_RECONCILIATION');
 const seen=new Set<string>();const candidates:BuyerDiscoveryResult['candidates']=[],fetchedAt=new Date().toISOString();
 for(const row of r.data){
  const property=row?.property as Record<string,unknown>|undefined;
  if(typeof row?.dm_person_id!=='string'||!/^per_[A-Za-z0-9]+$/.test(row.dm_person_id)||typeof property?.dm_property_id!=='string'||!/^prop_[A-Za-z0-9]+$/.test(property.dm_property_id))throw Error('BUYER_RESPONSE_INVALID');
  if(seen.has(row.dm_person_id))continue;seen.add(row.dm_person_id);
  candidates.push({personId:row.dm_person_id,name:typeof row.full_name==='string'?row.full_name.slice(0,200):'Potential buyer',propertyId:property.dm_property_id,propertyAddress:typeof property.full_address==='string'?property.full_address.slice(0,300):'',...buyerContactObservations(row.phones,row.emails),contactSource:'dealmachine',contactObservedAt:fetchedAt,contactQualityVersion:'buyer-contacts-v1'});
 }
 await d.persist({creditsUsed:r.credits.used,peopleCredits:r.credits.people,propertyCredits:r.credits.properties,estimatedCredits:c.this_page,hasNextPage:r.pagination.has_next_page,fetchedAt,candidates});
 return {status:r.credits.used>c.this_page||r.credits.properties>0?'needs_reconciliation':'buyers_saved',canContinue:r.pagination.has_next_page&&r.credits.used<=c.this_page&&r.credits.properties===0};
}
