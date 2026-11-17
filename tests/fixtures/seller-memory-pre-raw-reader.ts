// Captured pre-raw reader at 2174b3a614771cbbd8b57715789a3fb73cbd0242; only import paths adjusted.
import {object} from '../../lib/required-call-recording.ts';
import {sellerDialogueState,type SellerDialogueState} from '../../lib/seller-offer-qualification.ts';
import {sellerCommunicationPreferences} from '../../lib/seller-communication-intent.ts';

export const sellerMemoryVersion='seller-memory-v1';
export type SellerMemoryBinding={accountId:string;screeningId:string;phone:string;dealId?:string};
type Database=<T=unknown>(path:string,method?:string,body?:unknown)=>Promise<T>;
export type SellerMemory={history:unknown[];state:SellerDialogueState;fingerprint:string;complete:boolean;liveCalls?:{conversationId:string;startedAt:string}[]};

/** Exact provider conversation already verified by the reception maintenance
 * binding. Retain middle answers; oversize histories get an explicit marker. */
export function sellerMemoryInboundTurns(raw:unknown){
 const c=object(raw),start=object(c.metadata).start_time_unix_secs;
 const turns=(Array.isArray(c.transcript)?c.transcript:[]).map(object)
  .filter(t=>['agent','user'].includes(String(t.role))&&typeof t.message==='string'&&t.message.length<=12000)
  .map(t=>({role:t.role,message:t.message,...(typeof start==='number'&&Number.isFinite(start)&&start>0&&start<=Date.now()/1000&&typeof t.time_in_call_secs==='number'&&Number.isFinite(t.time_in_call_secs)&&t.time_in_call_secs>=0&&t.time_in_call_secs<=600
   ?{at:new Date((start+t.time_in_call_secs)*1000).toISOString()}:{} )}));
 return turns.length>1000?[...turns.slice(0,961),...turns.slice(-40)]:turns;
}

/** Put actual speech time ahead of transcript ingestion. Keep each answer with
 * its own channel's question; an SMS never answers the concurrent call question. */
export function chronologicalSellerHistory(conversations:unknown[]):unknown[]{
 const exchanges:{at:number;order:number;value:unknown}[]=[];
 for(const raw of conversations){
  const c=object(raw),rows=c.transcript;if(!Array.isArray(rows))continue;
  let question='';const threadQuestions=new Map<string,string>();
  const start=typeof c.startedAt==='string'?Date.parse(c.startedAt):NaN;
  for(const [index,value] of rows.entries()){
   const turn=object(value);if(typeof turn.message!=='string')continue;
   const thread=typeof turn.threadId==='string'?turn.threadId:null;
   if(turn.role==='agent'){if(thread)threadQuestions.set(thread,turn.message);else question=turn.message;continue;}
   if(turn.role!=='user')continue;
   const seconds=turn.seconds??turn.time_in_call_secs;
   const spoken=Number.isFinite(start)&&typeof seconds==='number'&&Number.isFinite(seconds)&&seconds>=0?start+seconds*1000:NaN;
   const at=typeof turn.at==='string'?Date.parse(turn.at):Number.isFinite(spoken)?spoken:Date.parse(String(c.at));
   if(!Number.isFinite(at))continue;
   const sourceId=String(turn.sourceId??String(c.sourceId)+':'+index);
   exchanges.push({at,order:exchanges.length,value:{sourceId,at:new Date(at).toISOString(),channel:c.channel,
    transcript:[{role:'agent',message:thread?threadQuestions.get(thread)??'':question},{role:'user',message:turn.message,sourceId,at:new Date(at).toISOString(),channel:c.channel,
     ...(turn.questionUnverified===true?{questionUnverified:true}:{})}]}});
  }
 }
 return exchanges.sort((a,b)=>a.at-b.at||a.order-b.order).map(x=>x.value);
}

/** The private cache is a reproducible evidence projection, never permission,
 * underwriting or acceptance. Every read rechecks the canonical source hash. */
export async function readSellerMemory(db:Database,binding:SellerMemoryBinding):Promise<SellerMemory|null>{
 const args={p_account:binding.accountId,p_screening:binding.screeningId,p_phone:binding.phone};
 const raw=await db<unknown>('rpc/icash_seller_memory_context','POST',args);
 if(raw===null)return null; // Separately staged/disabled policy.
 const source=object(raw),bound=object(source.binding);
 if(bound.accountId!==binding.accountId||bound.screeningId!==binding.screeningId||bound.phone!==binding.phone
  ||binding.dealId&&bound.dealId!==binding.dealId||!Array.isArray(source.conversations)||typeof source.fingerprint!=='string')throw Error('SELLER_MEMORY_BINDING_REQUIRED');
 const history=chronologicalSellerHistory(source.conversations);
 const state=sellerDialogueState(null,history);
 // Older applications keep the conservative complete=false hold. This exact
 // source projection is usable only with typed uncertainty markers and the raw
 // source cap, independent of the extra question row before each answer.
 let complete=source.complete===true;
 if(source.receiptProjectionVersion!==undefined&&source.receiptProjectionVersion!=='seller-sms-receipts-v1')throw Error('SELLER_MEMORY_RECEIPT_PROJECTION_REQUIRED');
 if(source.receiptProjectionVersion==='seller-sms-receipts-v1'){
  const sms=source.conversations.map(object).filter(c=>c.channel==='sms');
  if(typeof source.receiptSourceComplete!=='boolean'||sms.length!==1)throw Error('SELLER_MEMORY_RECEIPT_PROJECTION_REQUIRED');
  const text=sms[0],rows=Array.isArray(text.transcript)?text.transcript.map(object):[];
  const original=rows.filter(t=>typeof t.receiptFingerprint==='string');
  if(text.receiptProjectionVersion!=='seller-sms-receipts-v1'||typeof text.receiptSourceComplete!=='boolean'
   ||!Number.isInteger(text.rawSourceCount)||Number(text.rawSourceCount)<0||Number(text.rawSourceCount)>1001
   ||original.length!==text.rawSourceCount||new Set(original.map(t=>t.sourceId)).size!==original.length
   ||original.some(t=>typeof t.sourceId!=='string'||! /^[a-f0-9]{64}$/.test(String(t.receiptFingerprint))||typeof t.questionUnverified!=='boolean')
   ||rows.some(t=>t.role==='user'&&(typeof t.questionUnverified!=='boolean'||typeof t.receiptFingerprint!=='string')))
   throw Error('SELLER_MEMORY_RECEIPT_PROJECTION_REQUIRED');
  complete=source.receiptSourceComplete===true&&text.receiptSourceComplete===true&&Number(text.rawSourceCount)<=1000;
 }
 if(!complete)state.qualification={ready:false,missing:[],stop:true,nextQuestion:'The full saved conversation needs reconciliation. Do not repeat qualification or quote from partial history.'};
 // Recompute from source even on a cache hit. A cache cannot manufacture facts.
 const projection={version:sellerMemoryVersion,...state};
 // Oversized exact quotes still participate in the source-backed answer. The
 // optional cache must not turn a complete history into a permanent retry loop.
 if(complete&&source.complete===true&&object(source.cached).version!==sellerMemoryVersion&&Buffer.byteLength(JSON.stringify(projection),'utf8')<=18000){
  const saved=await db('rpc/icash_save_seller_memory','POST',{...args,p_fingerprint:source.fingerprint,p_projection:projection});
  if(saved!==true)throw Error('SELLER_MEMORY_SOURCE_CHANGED');
 }
 const liveCalls=(Array.isArray(source.liveCalls)?source.liveCalls:[]).map(object).filter(c=>typeof c.conversationId==='string'&&typeof c.startedAt==='string'&&Number.isFinite(Date.parse(c.startedAt))) as {conversationId:string;startedAt:string}[];
 return {history,state,fingerprint:source.fingerprint,complete,liveCalls};
}

/** Bounded prompt evidence. The full quote remains in the private journal. */
export function sellerMemoryPrompt(memory:SellerMemory|null){
 if(!memory)return null;
 const facts:Record<string,{value:boolean;status:string;quote?:string;question?:string}>={};
 for(const [key,v] of Object.entries(memory.state.facts))facts[key]={value:v.value,status:v.status};
 const prompt={complete:memory.complete,priceRequested:memory.state.priceRequested,facts,communication:sellerCommunicationPreferences(memory.history),
  nextQuestion:memory.state.qualification.ready?null:memory.state.qualification.nextQuestion};
 // Every answered key survives the prompt budget. Include whole source pairs
 // where they fit; never clip an answer into a different meaning.
 for(const [key,v] of Object.entries(memory.state.facts).reverse()){
  const pair={quote:v.quote,question:v.question};
  if(JSON.stringify(prompt).length+JSON.stringify(pair).length<=1500)Object.assign(facts[key],pair);
 }
 return prompt;
}
