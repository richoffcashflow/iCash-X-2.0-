import {object,sha} from './required-call-recording.ts';
import {readSellerMemory} from './seller-memory.ts';
import {sellerAgreementEvidence} from './seller-agreement-evidence.ts';
import {sellerAgreementIdentityEvidence,sellerAgreementIdentityHold} from './seller-agreement-identity.ts';
import {dealTermsSchema} from './deal-documents.ts';

export type SellerCallPrefix={version:'seller-call-prefix-v1';conversationId:string;pairCount:number;fingerprint:string};
type Pair=[string,string,number];

/** Preserve full preceding agent speech and whole user replies. Clocks are part
 * of the hash; provider catch-up cannot insert or retime earlier evidence. */
export function sellerCallPairs(value:unknown,conversationId:string,now=Date.now()):{start:number;pairs:Pair[]}|null{
 const source=object(value);
 if(source.conversation_id!==conversationId&&source.conversationId!==conversationId)return null;
 const rows=source.transcript;if(!Array.isArray(rows)||rows.length>1000||Buffer.byteLength(JSON.stringify(rows),'utf8')>262144)return null;
 const rawStart=object(source.metadata).start_time_unix_secs;
 const start=typeof rawStart==='number'?rawStart*1000:typeof source.startedAt==='string'?Date.parse(source.startedAt):NaN;
 if(!Number.isFinite(start)||start<=0||start>now)return null;
 let question='',previous=-Infinity;const pairs:Pair[]=[];
 for(const raw of rows){
  const row=object(raw);if(!['agent','user'].includes(String(row.role)))continue;
  if(typeof row.message!=='string')return null;
  if(row.role==='agent'){question=row.message;continue;}
  const seconds=row.time_in_call_secs??row.seconds;
  if(typeof seconds!=='number'||!Number.isFinite(seconds)||seconds<0||seconds>600||seconds<previous||start+seconds*1000>now)return null;
  previous=seconds;pairs.push([question,row.message,seconds]);
 }
 return pairs.length?{start,pairs}:null;
}

export function sellerCallPrefix(value:unknown,conversationId:string,now=Date.now()):SellerCallPrefix|null{
 const proof=sellerCallPairs(value,conversationId,now);if(!proof)return null;
 return {version:'seller-call-prefix-v1',conversationId,pairCount:proof.pairs.length,fingerprint:sha(JSON.stringify([proof.start,proof.pairs]))};
}

/** Completion may append only neutral acknowledgements to the exact reviewed
 * prefix. Missing proof, inserted details and a substantive later question hold. */
export function sellerCallCompletionMatches(value:unknown,prefix:SellerCallPrefix,now=Date.now()){
 if(prefix.version!=='seller-call-prefix-v1'||!Number.isInteger(prefix.pairCount)||prefix.pairCount<1||! /^[a-f0-9]{64}$/.test(prefix.fingerprint))return false;
 const proof=sellerCallPairs(value,prefix.conversationId,now);
 if(!proof||proof.pairs.length<prefix.pairCount||sha(JSON.stringify([proof.start,proof.pairs.slice(0,prefix.pairCount)]))!==prefix.fingerprint)return false;
 const neutral=/^(?:(?:okay|ok|alright|all right|thanks|thank you|bye|goodbye|have a (?:good|great|nice) (?:day|night|evening)|you too|take care)[,.! ]*)+$/i;
 return proof.pairs.slice(prefix.pairCount).every(([question,answer])=>neutral.test(answer.trim())&&(!question.trim()||neutral.test(question.trim())));
}

type Database=<T=unknown>(path:string,method?:string,body?:unknown)=>Promise<T>;
/** This review can renew only the source fingerprint on the same never-created
 * original. The SQL CAS independently rechecks the manifest and all bindings. */
export async function reviewSellerAgreementMemory(db:Database,job:{id:string;accountId:string;dealId:string;phone:string;sellerName:string;expectedTerms:unknown},now=Date.now()){
 const raw=object(await db('rpc/icash_seller_agreement_memory_context','POST',{p_account:job.accountId,p_recovery:job.id}));
 const admission=object(raw.admission),current=object(raw.current),binding=object(current.binding),prefix=object(admission.callPrefix);
 if(binding.accountId!==job.accountId||binding.dealId!==job.dealId||binding.phone!==job.phone||typeof binding.screeningId!=='string'
  ||admission.phone!==job.phone||typeof raw.confirmationId!=='string'||typeof admission.fingerprint!=='string'||typeof current.fingerprint!=='string'
  ||typeof admission.conversationId!=='string'||prefix.conversationId!==admission.conversationId||prefix.version!=='seller-call-prefix-v1'
  ||!sellerCallCompletionMatches(raw.originalCall,prefix as SellerCallPrefix,now))return false;
 const terms=dealTermsSchema.safeParse(job.expectedTerms),originalTerms=dealTermsSchema.safeParse(admission.terms);
 if(!terms.success||!originalTerms.success||JSON.stringify(terms.data)!==JSON.stringify(originalTerms.data)||terms.data.seller!==job.sellerName)return false;
 const confirmation=object(admission.confirmation);
 if(confirmation.agreedPriceCents!==terms.data.priceCents||confirmation.sellerLegalName!==job.sellerName||confirmation.closingDate!==terms.data.closingDate
  ||confirmation.sendTextRequested!==true||confirmation.termsConfirmed!==true||confirmation.priceAndDateConfirmed!==true||confirmation.materialFactsChanged!==false)return false;
 if(!sellerAgreementEvidence(raw.originalCall,terms.data,now)||sellerAgreementIdentityHold(sellerAgreementIdentityEvidence(raw.originalCall,job.sellerName)))return false;
 // Pure canonical projection: no cache write is needed for admission review.
 const memory=await readSellerMemory(async<T>(path:string)=>{
  if(path==='rpc/icash_seller_memory_context')return current as T;
  if(path==='rpc/icash_save_seller_memory')return true as T;
  throw Error('SELLER_MEMORY_REVIEW_READ_ONLY');
 },{accountId:job.accountId,dealId:job.dealId,screeningId:binding.screeningId,phone:job.phone});
 if(!memory?.complete||memory.sourceHold||!memory.state.qualification.ready)return false;
 if(current.fingerprint===admission.fingerprint)return true;
 return await db('rpc/icash_refresh_seller_agreement_memory','POST',{p_account:job.accountId,p_confirmation:raw.confirmationId,
  p_expected_fingerprint:admission.fingerprint,p_new_fingerprint:current.fingerprint,p_call_prefix:prefix})===true;
}
