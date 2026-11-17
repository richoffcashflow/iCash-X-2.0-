import {object,sha} from './required-call-recording.ts';
import {readSellerMemory} from './seller-memory.ts';
import {sellerAgreementEvidence} from './seller-agreement-evidence.ts';
import {sellerAgreementIdentityEvidence,sellerAgreementIdentityHold} from './seller-agreement-identity.ts';
import {dealTermsSchema} from './deal-documents.ts';

export type SellerCallPrefix={version:'seller-call-prefix-v2';conversationId:string;pairCount:number;turnCount:number;fingerprint:string};
type SpeakerTurn=['agent'|'user',string,number|null];

/** Preserve full preceding agent speech and whole user replies. Clocks are part
 * of the hash; provider catch-up cannot insert or retime earlier evidence. */
export function sellerCallTurns(value:unknown,conversationId:string,now=Date.now()):{start:number;turns:SpeakerTurn[]}|null{
 const source=object(value);
 if(source.conversation_id!==conversationId&&source.conversationId!==conversationId)return null;
 const rows=source.transcript;if(!Array.isArray(rows)||rows.length>1000||Buffer.byteLength(JSON.stringify(rows),'utf8')>262144)return null;
 const rawStart=object(source.metadata).start_time_unix_secs;
 const start=typeof rawStart==='number'?rawStart*1000:typeof source.startedAt==='string'?Date.parse(source.startedAt):NaN;
 if(!Number.isFinite(start)||start<=0||start>now)return null;
 let previous=-Infinity;const turns:SpeakerTurn[]=[];
 for(const raw of rows){
  const row=object(raw);if(!['agent','user'].includes(String(row.role)))return null;
  if(row.role==='agent'&&row.message==null&&['tool_results','tool_calls'].some(key=>Array.isArray(row[key])&&(row[key] as unknown[]).length>0))continue;
  if(typeof row.message!=='string')return null;
  const seconds=row.time_in_call_secs??row.seconds??null;
  if(seconds===null){if(row.role==='user')return null;}
  else if(typeof seconds!=='number'||!Number.isFinite(seconds)||seconds<0||seconds>600||seconds<previous||start+seconds*1000>now)return null;
  else previous=seconds;
  turns.push([row.role as 'agent'|'user',row.message,seconds]);
 }
 return turns.some(t=>t[0]==='user')?{start,turns}:null;
}

export function sellerCallPrefix(value:unknown,conversationId:string,now=Date.now()):SellerCallPrefix|null{
 const proof=sellerCallTurns(value,conversationId,now);if(!proof)return null;
 return {version:'seller-call-prefix-v2',conversationId,pairCount:proof.turns.filter(t=>t[0]==='user').length,turnCount:proof.turns.length,fingerprint:sha(JSON.stringify([proof.start,proof.turns]))};
}

/** Provider-reserved live history can omit clocks. Reuse clocks from the
 * existing same-call GET only when every original speaker turn matches. A
 * stale prefix supplies no proof; a different/newer speech source holds. */
export function sellerCallPrefixFromProvider(live:unknown,provider:unknown,conversationId:string,now=Date.now()):{prefix:SellerCallPrefix|null;conflict:boolean}{
 const speech=(value:unknown)=>{
  const rows=object(value).transcript;if(!Array.isArray(rows)||rows.length>1000||Buffer.byteLength(JSON.stringify(rows),'utf8')>262144)return null;
  const result:[string,string][]=[];
  for(const value of rows){
   const row=object(value),toolOnly=row.message==null&&['agent','tool'].includes(String(row.role))&&['tool_results','tool_calls'].some(key=>Array.isArray(row[key])&&(row[key] as unknown[]).length>0);
   if(toolOnly)continue;
   if(!['agent','user'].includes(String(row.role))||typeof row.message!=='string')return null;
   result.push([String(row.role),row.message]);
  }
  return result.length?result:null;
 };
 const current=speech(live),original=speech(provider),bound=object(provider).conversation_id===conversationId||object(provider).conversationId===conversationId;
 if(!current||!original||!bound)return {prefix:null,conflict:true};
 if(JSON.stringify(current)===JSON.stringify(original))return {prefix:sellerCallPrefix(provider,conversationId,now),conflict:false};
 const stale=original.length<current.length&&original.every((turn,index)=>JSON.stringify(turn)===JSON.stringify(current[index]));
 return {prefix:null,conflict:!stale};
}

/** Completion may append only neutral acknowledgements to the exact reviewed
 * prefix. Missing proof, inserted details and a substantive later question hold. */
export function sellerCallCompletionMatches(value:unknown,prefix:SellerCallPrefix,now=Date.now()){
 if(prefix.version!=='seller-call-prefix-v2'||!Number.isInteger(prefix.pairCount)||prefix.pairCount<1||!Number.isInteger(prefix.turnCount)||prefix.turnCount<prefix.pairCount||prefix.turnCount>1000||! /^[a-f0-9]{64}$/.test(prefix.fingerprint))return false;
 const proof=sellerCallTurns(value,prefix.conversationId,now),original=proof?.turns.slice(0,prefix.turnCount);
 if(!proof||!original||original.length!==prefix.turnCount||original.filter(t=>t[0]==='user').length!==prefix.pairCount||sha(JSON.stringify([proof.start,original]))!==prefix.fingerprint)return false;
 const neutral=/^(?:(?:okay|ok|alright|all right|thanks|thank you|bye|goodbye|have a (?:good|great|nice) (?:day|night|evening)|you too|take care)[,.! ]*)+$/i;
 return proof.turns.slice(prefix.turnCount).every(([,message])=>neutral.test(message.trim()));
}

type Database=<T=unknown>(path:string,method?:string,body?:unknown)=>Promise<T>;
/** This review can renew only the source fingerprint on the same never-created
 * original. The SQL CAS independently rechecks the manifest and all bindings. */
export async function reviewSellerAgreementMemory(db:Database,job:{id:string;accountId:string;dealId:string;phone:string;sellerName:string;expectedTerms:unknown},now=Date.now()){
 const raw=object(await db('rpc/icash_seller_agreement_memory_context','POST',{p_account:job.accountId,p_recovery:job.id}));
 const admission=object(raw.admission),current=object(raw.current),binding=object(current.binding),prefix=object(admission.callPrefix);
 if(binding.accountId!==job.accountId||binding.dealId!==job.dealId||binding.phone!==job.phone||typeof binding.screeningId!=='string'
  ||admission.phone!==job.phone||typeof raw.confirmationId!=='string'||typeof admission.fingerprint!=='string'||typeof current.fingerprint!=='string'
  ||typeof admission.conversationId!=='string'||prefix.conversationId!==admission.conversationId||prefix.version!=='seller-call-prefix-v2'
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
