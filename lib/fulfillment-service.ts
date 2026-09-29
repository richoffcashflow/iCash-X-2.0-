import {discoverBuyersForDeal} from './buyer-discovery-service.ts';
import {z} from 'zod';
import {db} from '@/lib/stripe-test';
import {planBuyerOutreach,type Buyer} from './buyer-engine.ts';
import {dealTermsSchema,renderDealDocument} from './deal-documents.ts';
const buyerCriteria=z.object({markets:z.array(z.string()),propertyTypes:z.array(z.string()),maxPriceCents:z.number().int().nonnegative().safe(),maxRepairCents:z.number().int().nonnegative().safe(),criteriaConfirmedAt:z.number().finite(),permitted:z.boolean(),proofOfFundsVerifiedAt:z.number().finite().nullable(),authorityVerified:z.boolean(),completedDeals:z.number().int().nonnegative().safe(),failedDeals:z.number().int().nonnegative().safe(),estimatedContactChargeCents:z.number().int().positive().safe()});
type Job={id:string;deal_id:string;purchase_envelope_id:string;state:string};
type Authority={purchase_envelope_id:string;expires_at:string;market:string;property_type:string;asking_price_cents:number;repairs_cents:number;retain_credit_cents:number};
export async function prepareFulfillment(accountId:string,jobId:string){
 const [job]=await db<Job[]>(`icash_fulfillment_jobs?id=eq.${jobId}&account_id=eq.${accountId}&select=*`);
 if(!job||job.state!=='issued')return {status:'held'};
 const [deal]=await db<{terms:unknown;stage:string}[]>(`icash_deal_files?id=eq.${job.deal_id}&account_id=eq.${accountId}&select=terms,stage`);
 const [signed]=await db<{id:string}[]>(`icash_signing_envelopes?id=eq.${job.purchase_envelope_id}&account_id=eq.${accountId}&deal_id=eq.${job.deal_id}&kind=eq.purchase&state=eq.completed&test_mode=eq.false&select=id`);
 if(!deal||!signed||!['under_contract','buyer_selected','title_open','closing'].includes(deal.stage))return {status:'signed_purchase_required'};
 const terms=dealTermsSchema.parse(deal.terms);
 const documents=(['buyer_package','title_packet'] as const).map(kind=>({kind,html:renderDealDocument(kind,terms)}));
 const [authority]=await db<Authority[]>(`icash_disposition_authorities?deal_id=eq.${job.deal_id}&account_id=eq.${accountId}&select=*`);
 let matches:{id:string;score:number;ready:boolean;rank:number;sourceRef:string}[]=[];
 let buyerStatus='marketing_review_required';
 if(authority&&authority.purchase_envelope_id===signed.id&&Date.parse(authority.expires_at)>Date.now()&&terms.priceCents!==null&&terms.assignmentFeeCents!==null&&authority.asking_price_cents===terms.priceCents+terms.assignmentFeeCents){
  const [wallet]=await db<{balance_cents:number;reserved_cents:number}[]>(`icash_wallets?account_id=eq.${accountId}&select=balance_cents,reserved_cents`);
  const buyers=await db<{id:string;entity_key:string;criteria:Omit<Buyer,'id'|'entityId'>;source_ref:string}[]>(`icash_buyer_profiles?account_id=eq.${accountId}&select=id,entity_key,criteria,source_ref&order=updated_at.desc&limit=500`);
  const valid=buyers.filter(b=>buyerCriteria.safeParse(b.criteria).success);
  const plan=planBuyerOutreach({market:authority.market,propertyType:authority.property_type,askingPriceCents:authority.asking_price_cents,repairsCents:authority.repairs_cents,sellerContractSigned:true,marketingAuthorized:true},valid.map(b=>({...b.criteria,id:b.id,entityId:b.entity_key})),Date.now(),Math.max(0,(wallet?.balance_cents??0)-(wallet?.reserved_cents??0)),authority.retain_credit_cents);
  matches=plan.matches.slice(0,50).map((m,i)=>({...m,rank:i+1,sourceRef:valid.find(b=>b.id===m.id)!.source_ref}));
  buyerStatus=matches.length?'matches_ready_outreach_not_sent':'buyer_sourcing_required';
 }
 let buyerDiscovery:{status:string;canContinue:boolean};
 try{buyerDiscovery=await discoverBuyersForDeal(accountId,job.deal_id);}catch{buyerDiscovery={status:'buyer_search_needs_review',canContinue:false};}
 const result={buyerDiscovery,buyerStatus,buyerCount:matches.length,titleStatus:'request_prepared_not_sent',contractStatus:'verified_purchase',sent:false,depositReceived:false,closed:false};
 await db('rpc/icash_save_fulfillment','POST',{p_job:job.id,p_result:result,p_documents:documents,p_matches:matches});
 return {status:'fulfillment_prepared'};
}
