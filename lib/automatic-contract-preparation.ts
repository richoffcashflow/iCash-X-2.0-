import {createHash} from 'node:crypto';
import {dealTermsSchema} from './deal-documents.ts';
import {contractPreparation,fillEmptyTerms,type TermMessage} from './contract-preparation.ts';
type Database=<T>(path:string,method?:string,body?:unknown)=>Promise<T>;
const eq=encodeURIComponent;
/** Internal draft assistance only. No provider requests, offer authority or signing transitions. */
export async function prepareCompletedSellerDraft(db:Database,accountId:string,callId:string){
 const [call]=await db<{screening_id:string;party:string;state:string;result:{humanRequested?:boolean;optedOut?:boolean}|null}[]>(`icash_live_conversations?account_id=eq.${eq(accountId)}&id=eq.${eq(callId)}&select=screening_id,party,state,result`);
 if(!call||call.party!=='seller'||call.state!=='complete'||!call.result||call.result.humanRequested||call.result.optedOut)return {status:'draft_unchanged'};
 const [account]=await db<{bot_paused:boolean}[]>(`icash_accounts?id=eq.${eq(accountId)}&select=bot_paused`);
 const [screening]=await db<{snapshot:{propertyId?:string}}[]>(`icash_screening_jobs?account_id=eq.${eq(accountId)}&id=eq.${eq(call.screening_id)}&state=eq.complete&select=snapshot`);
 if(account?.bot_paused!==false||!screening?.snapshot?.propertyId)return {status:'draft_unchanged'};
 const controls=await db<{manual:boolean}[]>(`icash_property_controls?account_id=eq.${eq(accountId)}&property_id=eq.${eq(screening.snapshot.propertyId)}&select=manual`);
 if(controls.some(c=>c.manual))return {status:'draft_unchanged'};
 const deals=await db<{id:string;terms:Record<string,unknown>;updated_at:string}[]>(`icash_deal_files?account_id=eq.${eq(accountId)}&screening_id=eq.${eq(call.screening_id)}&stage=eq.draft&select=id,terms,updated_at&limit=2`);
 if(deals.length!==1)return {status:'draft_unchanged'};
 const deal=deals[0];
 // An envelope freezes its terms even before anyone signs. Never alter or resend it.
 if((await db<{id:string}[]>(`icash_signing_envelopes?account_id=eq.${eq(accountId)}&deal_id=eq.${eq(deal.id)}&select=id&limit=1`)).length)return {status:'draft_unchanged'};
 const calls=await db<{id:string;contact_key:string;party:'seller'|'buyer';result:{transcript?:{role:string;message:string}[]}}[]>(`icash_live_conversations?account_id=eq.${eq(accountId)}&screening_id=eq.${eq(call.screening_id)}&state=eq.complete&party=eq.seller&select=id,contact_key,party,result&order=completed_at.asc&limit=151`);
 if(calls.length>150)return {status:'draft_review_needed'};
 const messages:TermMessage[]=calls.flatMap(c=>(c.result?.transcript??[]).filter(t=>t.role==='user').map((t,n)=>({id:`${c.id}:${n}`,party:c.party,body:t.message,partyKey:c.contact_key||c.id})));
 const threads=await db<{id:string;recipient:string}[]>(`icash_text_threads?account_id=eq.${eq(accountId)}&deal_id=eq.${eq(deal.id)}&party=eq.seller&select=id,recipient&limit=151`);
 if(threads.length>150)return {status:'draft_review_needed'};
 if(threads.length){
  const texts=await db<{id:string;thread_id:string;body:string}[]>(`icash_text_messages?account_id=eq.${eq(accountId)}&thread_id=in.(${threads.map(t=>eq(t.id)).join(',')})&direction=eq.incoming&state=eq.received&select=id,thread_id,body&order=created_at.asc&limit=151`);
  for(const t of texts){const thread=threads.find(th=>th.id===t.thread_id);if(thread)messages.push({id:t.id,party:'seller',body:t.body,partyKey:createHash('sha256').update(thread.recipient).digest('hex')});}
 }
 // Do not silently drop older refusals, conditions or conflicting parties.
 if(messages.length>150)return {status:'draft_review_needed'};
 const editable=Object.fromEntries(Object.entries(deal.terms).filter(([key])=>Object.hasOwn(dealTermsSchema.shape,key)));
 const current=dealTermsSchema.parse(editable);
 // Already-confirmed customer terms need an explicit amendment/review, not automatic assistance.
 if(current.priceSource!=='proposed')return {status:'draft_unchanged'};
 const prepared=contractPreparation(messages,'draft',current);
 if(prepared.conflicts.length)return {status:'draft_review_needed'};
 if(!Object.keys(prepared.patch).length)return {status:'draft_unchanged'};
 const terms={...deal.terms,...fillEmptyTerms(current,prepared.patch)};
 // Compare-and-set protects edits made after this read; the existing DB sent-term freeze
 // independently rejects a race with envelope creation. No retry overwrites newer edits.
 const updated=await db<{id:string}[]>(`icash_deal_files?account_id=eq.${eq(accountId)}&id=eq.${eq(deal.id)}&stage=eq.draft&updated_at=eq.${eq(deal.updated_at)}&terms=eq.${eq(JSON.stringify(deal.terms))}&select=id`,'PATCH',{terms,updated_at:new Date().toISOString()});
 return {status:updated.length===1?'draft_prepared':'draft_unchanged'};
}
