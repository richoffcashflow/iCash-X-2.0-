import {hasHumanCallWords} from './call-contact-evidence.ts';
import {sellerAffirmation,sellerPropertyAnswer,sellerUnrelatedAnswer,sellerExplicitUnknown,sellerStatementText,sellerAnswerText} from './seller-answer-evidence.ts';
import {sellerInterestPatterns} from './seller-interest-evidence.ts';
import {object} from './required-call-recording.ts';
import {sellerListingEvidence} from './seller-listing.ts';
import {sellerRequestsPrice} from './seller-conversation-efficiency.ts';
import {callSellerPriceEvidence} from './call-offer-evidence.ts';
import {sellerConversionIntent} from './seller-conversion-intent.ts';
import {sellerCallDisposition} from './seller-response-policy.ts';
import {readSellerMemory,chronologicalSellerHistory} from './seller-memory.ts';

const questions={
 ownership:'Are you the owner of this property?',
 availability:'Is now a good time to talk about the property?',
 interest:'Are you looking to sell the property?',
 situation:'What has you thinking about selling?',
 condition:'What kind of repairs or updates does it need?',
 occupancy:'Is anyone living in the property right now?',
 timing:'When would you ideally like to sell?',
 listing:'Is the property currently listed with a real estate agent?',
};
export type SellerFact=keyof typeof questions;
type Fact=SellerFact;
export type SellerFactEvidence={value:boolean;status:'answered'|'unknown'|'declined';quote:string;question:string;sourceId:string;at:string|null;channel:string};
export type SellerDialogueState={qualification:SellerQualification;facts:Partial<Record<Fact,SellerFactEvidence>>;priceRequested:boolean};
export type SellerQualification={ready:true}|{ready:false;nextQuestion:string;missing:Fact[];stop?:boolean};
const yes={test:sellerAffirmation};
// Reuse the already source-bound interest vocabulary. These phrases answer a
// selling question or explicitly declare selling interest; they are never an
// ownership answer, an accepted price or permission to send an agreement.
const interestAffirmation=new RegExp(sellerInterestPatterns.affirmative,'i');
const explicitInterest=new RegExp(sellerInterestPatterns.explicit,'i');
const differentSeller=/\b(?:i(?:'m| am) (?:his|her|their|the owner's) (?:wife|husband|son|daughter|tenant)|this is (?:his|her|their) (?:wife|husband|son|daughter)|i(?:'m| am) (?:just )?(?:the |a )?tenant)\b/i;
const no=/^(?:(?:um|uh|well)[, .]+)*(?:no|nope|not really|not interested)\b/i;
const answerable=(s:string)=>/[a-z0-9]/i.test(s)&&! /^(?:um|uh|hmm|hello|what|sorry|pardon)[.!? ]*$/i.test(s)&&! /\b(?:repeat (?:that|the question)|what do you mean|(?:didn['’]?t|did not) (?:hear|understand|catch)|(?:can|could|would) you (?:please )?(?:repeat|rephrase|say|ask|explain)|(?:say|ask) (?:that |it |the question )?again|what was (?:that|the question))\b/i.test(s);

/** An acknowledgement of an earlier answer is not the current question. In
 * particular, "you are the owner. Is anyone living there?" + "no" must not
 * revoke ownership or treat that occupancy answer as a refusal to sell. */
function latestQualificationQuestion(message:string):string{
 const sentences=message.match(/[^.!?;\n]+[.!?;]?/g)??[];
 const sentence=sentences.findLast(part=>part.trim().endsWith('?'))??sentences.at(-1)??'';
 const clauses=sentence.split(/,\s*(?=(?:is|are|do|does|did|have|has|can|could|would|will|what|when|where|why|who|how|tell me)\b)|\b(?:and|also)\s+(?=(?:is|are|do|does|did|can|could|would|will)\s+(?:you|it|anyone|anybody|the|your|this|that)\b)/i);
 return clauses.at(-1)?.trim()??'';
}

/** The caller's actual answers, never research, an opener, or an LLM summary.
 * Historical conversations must already be bound to this account/deal/contact.
 * An explicit unknown/refusal answers a personal question; do not interrogate. */
export function sellerDialogueState(current:unknown,history:unknown[]=[],channel:'voice'|'sms'='voice'):SellerDialogueState{
 const facts:Partial<Record<Fact,boolean>>={};let listed:boolean|null=null,priceRequested=false;
 const evidence:Partial<Record<Fact,SellerFactEvidence>>={};
 const result=(qualification:SellerQualification):SellerDialogueState=>({qualification,facts:evidence,priceRequested});
 const currentRows=object(current).transcript;
 // A contextual "no" answers the final question, not an acknowledgement
 // such as "you want to sell" before an occupancy/repairs question.
 const disposition=Array.isArray(currentRows)?sellerCallDisposition(currentRows.map(row=>{
  const turn=object(row);
  return {role:String(turn.role??''),message:typeof turn.message==='string'?(turn.role==='agent'?latestQualificationQuestion(turn.message):turn.message):null};
 })):null;

 for(const conversation of [...history,current]){
  // A past bad time is not a permanent hold. Ownership and interest
  // corrections persist until explicitly changed; current refusals always win.
  for(const key of ['availability'] as const)if(facts[key]===false){delete facts[key];delete evidence[key];}
  const rows=object(conversation).transcript;if(!Array.isArray(rows))continue;
  let question='';
  for(let index=0;index<rows.length;index++){
   const row=object(rows[index]);if(typeof row.message!=='string')continue;
   const text=row.message.trim();
   if(row.role==='agent'){question=latestQualificationQuestion(text);continue;}
   if(row.role!=='user'||!answerable(text)||!hasHumanCallWords(text)||sellerUnrelatedAnswer(text))continue;
   const statement=sellerStatementText(text);
   const remember=(key:Fact,value:boolean,onlyIfMissing=false)=>{
    if(onlyIfMissing&&facts[key]!==undefined)return;
    facts[key]=value;evidence[key]={value,status:!value?'declined':sellerExplicitUnknown(text)?'unknown':'answered',quote:text,question,sourceId:String(row.sourceId??row.id??object(conversation).sourceId??''),at:typeof row.at==='string'?row.at:typeof object(conversation).at==='string'?String(object(conversation).at):null,channel:String(row.channel??object(conversation).channel??channel)};
   };
   const ownerQuestion=/\b(?:owner|do you own|is (?:this|that|it|.+?) your property)\b/i.test(question)&&/\?/.test(question)&&!/(?:\b(?:only|sole|other|another) owner\b|\b(?:anyone|anybody) else\b)/i.test(question);
   const availabilityQuestion=String(row.channel??object(conversation).channel??channel)!=='sms'&&/\b(?:good time|time to (?:talk|chat)|(?:have|got) (?:a (?:quick )?minute|a (?:couple|few) (?:of )?minutes))\b/i.test(question);
   const interestQuestion=/\b(?:interested in selling|(?:want|looking|ready|like) to sell|consider(?:ing)? selling|considered a cash sale|open to a cash offer|consider selling)\b/i.test(question)&&/\?/.test(question);
   const situationQuestion=/\b(?:what(?:'s| is) going on|what.*(?:thinking|looking|want|decid)|why.*sell|reason.*sell|tell me.*situation)\b/i.test(question);
   if(ownerQuestion&&(yes.test(text)||no.test(text)))remember('ownership',!no.test(text));
   if(availabilityQuestion&&(yes.test(text)||no.test(text)))remember('availability',!no.test(text));
   if(availabilityQuestion&&/\b(?:not now|(?:can't|cannot) talk|not a good time|busy right now)\b/i.test(text))remember('availability',false);
   if(/\b(?:i(?:'m| am) (?:the |an? )?owner|i (?:still )?own (?:it|this|the (?:house|property)))\b/i.test(statement))remember('ownership',true);
   if(/\b(?:not (?:the )?owner|don['’]?t own|do not own|wrong (?:number|person|property)|no longer own)\b/i.test(statement))remember('ownership',false);
   if(differentSeller.test(text)){
    delete facts.ownership;delete evidence.ownership;delete facts.interest;delete evidence.interest;
   }
   const intent=sellerConversionIntent(text);
   if(sellerRequestsPrice(text)||intent==='price'||intent==='identity_price'||intent==='listed_terms'||callSellerPriceEvidence({transcript:rows.slice(0,index+1)},{action:'report_change',sellerStatement:text})!==null){
    remember('availability',true,true);remember('interest',true,true);
    priceRequested=true;
    // An offer question is not an answer to a pending repairs/occupancy question.
    if(!sellerPropertyAnswer('condition',text)&&!sellerPropertyAnswer('occupancy',text)&&!sellerPropertyAnswer('timing',text))question='';
   }
   if(interestQuestion&&(yes.test(text)||interestAffirmation.test(sellerAnswerText(text))||/^(?:i would|i do|i will)[.! ]*$/i.test(text)||no.test(text)))remember('interest',!no.test(text));
   if(explicitInterest.test(sellerAnswerText(text)))remember('interest',true);
   if(/\b(?:(?:want|looking|ready|need|hoping|trying|plan|planning|like) to sell|interested in selling|(?:sell|selling) (?:it|my|the|this))\b/i.test(statement))remember('interest',true);
   if(/\b(?:not (?:interested|looking|ready).*sell|don['’]?t want to sell|do not want to sell|not selling)\b/i.test(statement))remember('interest',false);
   if(situationQuestion&&sellerPropertyAnswer('situation',text)){remember('situation',true);remember('interest',true,true);}
   if(/\b(?:moving|relocat\w*|inherited|inheritance|tired of|downsizing|too much (?:work|upkeep)|can['’]?t (?:afford|maintain)|rather not (?:say|discuss))\b/i.test(statement))remember('situation',true);
   if(/\b(?:condition|repairs?|updates?|work.*need|need.*work|shape.*(?:house|property))\b/i.test(question)&&sellerPropertyAnswer('condition',text))remember('condition',true);
   if(/\b(?:needs? (?:a |an |some |new |major |minor )?(?:roof|work|repairs?|updat\w*|ac|paint)|gutted|good (?:shape|condition)|bad condition|fixer|recently (?:renovated|remodeled))\b/i.test(statement))remember('condition',true);
   if(/\b(?:(?:anyone|anybody|someone|who).*\bliv(?:e|es|ing)|occup(?:ied|ancy)|vacant|tenants?)\b/i.test(question)&&sellerPropertyAnswer('occupancy',text))remember('occupancy',true);
   if(/\b(?:vacant|(?:no one|nobody|tenants?).*\bliv(?:e|es|ing)|i live|we live|rented out|unoccupied|family occupied|owner occupied|tenant occupied)\b/i.test(statement))remember('occupancy',true);
   if(/\b(?:when.*(?:sell|clos(?:e|ing)|mov(?:e|ing))|(?:selling|closing) (?:timeline|timeframe)|how (?:soon|quickly)|ideal.*(?:time|date))\b/i.test(question)&&sellerPropertyAnswer('timing',text))remember('timing',true);
   if(/\b(?:next \w+ (?:days?|weeks?|months?)|as soon as possible|asap|no (?:rush|deadline)|(?:sell|close|move) (?:in|by|before|after|within))\b/i.test(statement))remember('timing',true);
   const listing=sellerListingEvidence({transcript:rows.slice(0,index+1)},{action:'report_change',sellerStatement:text});
   if(listing!==null){remember('listing',true);listed=listing;}
   // A caller volunteering or answering property details is already conversing;
   // do not insert an unnecessary time-to-talk question on a return call.
   if(facts.availability===undefined&&(facts.situation||facts.condition||facts.occupancy||facts.timing))remember('availability',true);
  }
 }
 // A source-bound SMS answer is already an active text conversation. Do not
 // ask a phone-availability question as a prerequisite to continuing by text.
 // An actual refusal still wins below; this creates no calling permission.
 // A price-first seller need not supply a personal motivation. This changes no
 // property facts, offer calculation, listing rule, acceptance or signing gate.
 if(disposition)return result({ready:false,missing:[],stop:true,nextQuestion:'The seller has stopped this discussion or requested review. Honor the request; do not continue qualification.'});
 const missing=(Object.keys(questions) as Fact[]).filter(key=>facts[key]!==true&&(channel!=='sms'||key!=='availability')&&(!priceRequested||key!=='situation'));
 if(facts.ownership===false||facts.interest===false||facts.availability===false||listed===true)return result({ready:false,missing,stop:true,nextQuestion:listed?'This property is listed with an agent. Do not quote an offer; follow the listing policy and end politely.':'The caller has declined this property discussion. Acknowledge and stop the pitch.'});
 return result(missing.length?{ready:false,missing,nextQuestion:questions[missing[0]]}:{ready:true});
}

export function sellerOfferQualification(current:unknown,history:unknown[]=[],channel:'voice'|'sms'='voice'):SellerQualification{
 return sellerDialogueState(current,history,channel).qualification;
}

export function sellerQualificationHold(result:Exclude<SellerQualification,{ready:true}>){
 return {quoteAllowed:false as const,priceCents:null,contractAllowed:false,sent:false,status:'qualification',reason:'seller_qualification_required',nextQuestion:result.nextQuestion,
  instruction:result.stop?result.nextQuestion:`This is a normal conversation step, not a failed calculation. No numerical offer is authorized yet. Introduce the saved company/principal only if still missing. Ask the next question directly, without a routine thank-you or repeating their answer: "${result.nextQuestion}" Then listen. Do not retry the tool until they answer; do not invent facts or repeat completed questions.`,missing:result.missing};
}

type Db=<T>(path:string,method?:string,body?:unknown)=>Promise<T>;
type SavedSellerText={id:string;direction:string;body:string;state:string;provider_id:string|null;event_id:string|null;last_delivery_at:string|null;created_at:string};
/** Event IDs come only from the already tenant/thread-bound incoming rows. Read
 * just original event times, in bounded batches; ingestion time is not proof
 * that an ambiguous answer followed delivery of a question. */
async function sellerTextEventTimes(db:Db,messages:SavedSellerText[]){
 const ids=[...new Set(messages.filter(m=>m.direction==='incoming'&&m.state==='received'&&m.event_id&&m.event_id.length<=512).map(m=>m.event_id!))];
 const times=new Map<string,number>();
 await Promise.all(Array.from({length:Math.ceil(ids.length/25)},async(_,index)=>{
  const batch=ids.slice(index*25,index*25+25),filter=batch.map(id=>JSON.stringify(id)).join(',');
  const events=await db<{id:string;type:string;source_time:unknown}[]>(`icash_text_events?id=in.(${encodeURIComponent(filter)})&select=id,type,source_time:payload->timestamp&limit=25`);
  if(!Array.isArray(events)||events.length>25)throw Error('SELLER_TEXT_EVENT_ORDER_REQUIRED');
  for(const event of events)if(batch.includes(event.id)&&['text.incoming.sms','text.incoming.mms'].includes(event.type)&&typeof event.source_time==='number'&&Number.isFinite(event.source_time)&&event.source_time>0&&event.source_time*1000<=Date.now())times.set(event.id,Math.floor(event.source_time*1000));
 }));
 return new Map(messages.map(m=>{
  const at=m.event_id?times.get(m.event_id):undefined;
  return [m.id,at!==undefined&&at<=Date.parse(m.created_at)+300000?at:null];
 }));
}
/** Reuse real answers on return calls, scoped by server-resolved IDs. A reset
 * creates a new screening/deal, so the old property's answers cannot leak in. */
export async function boundSellerQualification(db:Db,context:{accountId?:string;dealId?:string;screeningId?:string;phone?:string;conversationId?:string},current:unknown,readCurrent?:()=>Promise<unknown>){
 const first=sellerOfferQualification(current);if(!first.ready&&first.stop)return first;
 const {accountId,dealId,screeningId,phone}=context;
 if(!accountId||!dealId||!screeningId||!phone)return first;
 const memory=await readSellerMemory(db,{accountId,dealId,screeningId,phone});
 if(memory){
  if(!memory.complete)return memory.state.qualification;
  const live=memory.liveCalls?.find(c=>c.conversationId===context.conversationId);
  const concurrent=live?memory.history.filter(h=>object(h).channel==='sms'&&Date.parse(String(object(h).at))>=Date.parse(live.startedAt)):[];
  if(concurrent.length){
   // New written refusals cannot be overwritten by an earlier spoken yes.
   for(const sms of concurrent){const result=sellerOfferQualification(sms);if(!result.ready&&result.stop)return result;}
   const hold:SellerQualification={ready:false,missing:[],stop:true,nextQuestion:'A newer text arrived during this call. Its timing needs reconciliation before an offer; do not restart answered qualification or claim a delivery.'};
   let fresh:Record<string,unknown>;try{fresh=object(readCurrent?await readCurrent():current);}catch{return hold;}
   const start=object(fresh.metadata).start_time_unix_secs,rows=fresh.transcript,prior=object(current).transcript;
   if(fresh.conversation_id!==context.conversationId||typeof start!=='number'||!Number.isFinite(start)||start<=0||start*1000<Date.parse(live!.startedAt)-5000||start*1000>Date.now()||!Array.isArray(rows)
    ||rows.some(r=>object(r).role==='user'&&(typeof object(r).time_in_call_secs!=='number'||!Number.isFinite(object(r).time_in_call_secs)||Number(object(r).time_in_call_secs)<0||Number(object(r).time_in_call_secs)>600)))return hold;
   const spoken=rows.map(object).filter(t=>t.role==='user').map(t=>t.message);
   const supplied=Array.isArray(prior)?prior.map(object).filter(t=>t.role==='user').map(t=>t.message):[];
   if(supplied.some((message,index)=>spoken[index]!==message))return hold; // Provider GET has not caught up yet.
   const ordered=chronologicalSellerHistory([...memory.history,{...fresh,sourceId:'current:'+context.conversationId,channel:'voice',startedAt:new Date(start*1000).toISOString()}]);
   return sellerOfferQualification(null,ordered);
  }
  return sellerOfferQualification(current,memory.history);
 }
 const incomplete:SellerQualification={ready:false,missing:[],stop:true,nextQuestion:'The full saved conversation needs reconciliation. Do not repeat qualification or quote from partial history.'};
 const threadPath=`icash_text_threads?account_id=eq.${accountId}&deal_id=eq.${dealId}&recipient=eq.${encodeURIComponent(phone)}&party=eq.seller&retired_at=is.null&select=id&limit=2`;
 let calls:unknown[],threads:{id:string}[];
 try{[calls,threads]=await Promise.all([
  first.ready?Promise.resolve([]):db<unknown[]>('rpc/icash_seller_prior_call_context','POST',{p_account:accountId,p_screening:screeningId,p_phone:phone}),
  db<{id:string}[]>(threadPath),
 ]);}catch{return incomplete;}
 if(!Array.isArray(threads)||threads.length>1)return incomplete;
 const history=Array.isArray(calls)?calls.map(c=>({at:String(object(c).completed_at??''),value:object(c).result})):[];
 if(threads.length===1){
  // Read one overflow row rather than treating the oldest 200 as complete. An
  // omitted later refusal/correction must not inherit an older positive answer.
  const messagePath=`icash_text_messages?account_id=eq.${accountId}&thread_id=eq.${threads[0].id}&select=id,direction,body,state,provider_id,event_id,last_delivery_at,created_at&order=created_at.asc,id.asc&limit=201`;
  let messages:SavedSellerText[];try{messages=await db<SavedSellerText[]>(messagePath);}catch{return incomplete;}
  const snapshot=JSON.stringify(messages),smsHistory:{value:unknown;at:number;original:boolean}[]=[];
  if(!Array.isArray(messages)||messages.length>200)return incomplete;
  let sourceTimes:Map<string,number|null>;try{sourceTimes=await sellerTextEventTimes(db,messages);}catch{return incomplete;}
  const messageTime=(m:SavedSellerText)=>m.direction==='incoming'?(sourceTimes.get(m.id)??Date.parse(m.created_at)):Date.parse(m.created_at);
  const outgoingTimes=new Set(messages.filter(m=>m.direction==='outgoing').map(messageTime)),incomingTimes=new Set<number>();
  for(const m of messages){
   const at=messageTime(m);if(!Number.isFinite(at))return incomplete;
   if(m.direction==='incoming'&&m.state==='received'&&(m.provider_id||m.event_id)){
    // A UUID tie-break makes pagination stable, not simultaneous answers
    // chronological. Do not let arbitrary ID order undo a seller correction.
    if(incomingTimes.has(at))return incomplete;incomingTimes.add(at);
   }
  }
  let question='',questionAt=Infinity;
  for(const m of [...messages].sort((a,b)=>messageTime(a)-messageTime(b))){
   if(m.direction==='outgoing'){
    // Unconfirmed messages remain boundaries, so a later "yes" cannot borrow
    // an older question. A delivery arriving after the answer is insufficient.
    const delivered=Date.parse(m.last_delivery_at??'');
    question=m.state==='delivered'&&m.provider_id&&Number.isFinite(delivered)&&delivered>=Date.parse(m.created_at)&&delivered<=Date.now()?m.body:'';
    questionAt=delivered;continue;
   }
   if(m.direction==='incoming'){
    if(m.state!=='received'||!(m.provider_id||m.event_id)){question='';continue;}
    const at=messageTime(m),originalAt=sourceTimes.get(m.id);
    const value={sourceId:m.id,at:new Date(at).toISOString(),channel:'sms',transcript:[{role:'agent',message:originalAt!==null&&originalAt!==undefined&&originalAt>questionAt&&!outgoingTimes.has(at)?question:''},{role:'user',message:m.body}]};
    history.push({at:value.at,value});smsHistory.push({value,at,original:originalAt!==null&&originalAt!==undefined});
   }
  }
  const conflicts=smsHistory.map(sms=>({...sms,state:sellerDialogueState(sms.value,[],'sms'),identityChanged:(object(sms.value).transcript as {role:string;message:string}[]).some(t=>t.role==='user'&&differentSeller.test(t.message))}))
   .filter(sms=>sms.identityChanged||!sms.state.qualification.ready&&sms.state.qualification.stop);
  if(conflicts.length){
   // Contact stops/review requests are not reversible qualification facts. An
   // unstructured withdrawal also cannot be erased by a generic later yes.
   for(const sms of conflicts){
    const rows=object(sms.value).transcript as {role:string;message:string}[];
    const disposition=sellerCallDisposition(rows.map(t=>({...t,message:t.role==='agent'?latestQualificationQuestion(t.message):t.message})));
    if(disposition==='opt_out'||disposition==='review'||!(sms.state.facts.ownership?.value===false||sms.state.facts.interest?.value===false||sms.state.facts.listing||sms.identityChanged))return sms.state.qualification;
   }
   const hold:SellerQualification={ready:false,missing:[],stop:true,nextQuestion:'A saved text conflicts with this call. Its timing needs reconciliation before an offer; honor the seller request and do not repeat answered qualification.'};
   if(!context.conversationId||smsHistory.some(sms=>!sms.original))return hold;
   let fresh:Record<string,unknown>;try{fresh=object(readCurrent?await readCurrent():current);}catch{return hold;}
   const start=object(fresh.metadata).start_time_unix_secs,rows=fresh.transcript,prior=object(current).transcript,suppliedStart=object(object(current).metadata).start_time_unix_secs;
   if(fresh.conversation_id!==context.conversationId||typeof start!=='number'||!Number.isFinite(start)||start<=0||start*1000>Date.now()||!Array.isArray(rows)||rows.length>1000||typeof suppliedStart==='number'&&start!==suppliedStart)return hold;
   const voiceRows=rows.map(object).filter(t=>t.role==='agent'||t.role==='user');
   const supplied=Array.isArray(prior)?prior.map(object).filter(t=>t.role==='agent'||t.role==='user'):[];
   if(supplied.some((turn,index)=>voiceRows[index]?.role!==turn.role||voiceRows[index]?.message!==turn.message))return hold;
   let previous=-Infinity;
   for(const turn of voiceRows.filter(t=>t.role==='user')){
    const seconds=turn.time_in_call_secs;
    if(typeof seconds!=='number'||!Number.isFinite(seconds)||seconds<0||seconds>600||seconds<previous||(start+seconds)*1000>Date.now()||smsHistory.some(sms=>sms.at===Math.floor((start+seconds)*1000)))return hold;
    previous=seconds;
   }
   // Completion before every timed source proves the prior call's answers
   // precede this conflict without inventing missing per-turn speech times.
   const cutoff=Math.min(start*1000,...smsHistory.map(sms=>sms.at));
   const priorCalls=Array.isArray(calls)?calls.map(c=>({at:Date.parse(String(object(c).completed_at??'')),value:object(c).result})):[];
   if(priorCalls.some(c=>!Number.isFinite(c.at)||c.at<=0||c.at>=cutoff))return hold;
   const freshQualification=sellerOfferQualification(fresh);if(!freshQualification.ready&&freshQualification.stop)return freshQualification;
   // Recheck bounded sources after the provider read. A concurrent message or
   // receipt change must not be hidden behind the original history snapshot.
   try{const [latest,latestThreads]=await Promise.all([db<SavedSellerText[]>(messagePath),db<{id:string}[]>(threadPath)]);
    if(JSON.stringify(latest)!==snapshot||JSON.stringify(latestThreads)!==JSON.stringify(threads))return hold;
   }catch{return hold;}
   const ordered=chronologicalSellerHistory([...smsHistory.map(sms=>sms.value),{sourceId:'current:'+context.conversationId,channel:'voice',startedAt:new Date(start*1000).toISOString(),transcript:voiceRows.map(t=>({role:t.role,message:t.message,time_in_call_secs:t.time_in_call_secs}))}]);
   const result=sellerOfferQualification(null,[...priorCalls.sort((a,b)=>a.at-b.at).map(c=>c.value),...ordered]);
   if(!result.ready&&conflicts.some(sms=>sms.identityChanged)&&(result.missing.includes('ownership')||result.missing.includes('interest')))return {...result,stop:true,nextQuestion:'The text identifies a different speaker. Confirm the current speaker’s ownership and interest before an offer; do not reuse the previous owner’s answers.'};
   return result;
  }
 }
 if(first.ready)return first;
 history.sort((a,b)=>(Date.parse(a.at)||0)-(Date.parse(b.at)||0));
 return sellerOfferQualification(current,history.map(h=>h.value));
}
