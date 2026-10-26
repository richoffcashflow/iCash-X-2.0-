import {object} from './required-call-recording.ts';
import {sellerListingEvidence} from './seller-listing.ts';
import {sellerRequestsPrice} from './seller-conversation-efficiency.ts';

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
type Fact=keyof typeof questions;
export type SellerQualification={ready:true}|{ready:false;nextQuestion:string;missing:Fact[];stop?:boolean};
const yes=/^(?:(?:um|uh|well)[, .]+)*(?:yes|yeah|yep|sure|correct|absolutely|i am|it is|that's right|that is right)\b/i;
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
export function sellerOfferQualification(current:unknown,history:unknown[]=[]):SellerQualification{
 const facts:Partial<Record<Fact,boolean>>={};let listed:boolean|null=null;
 for(const conversation of [...history,current]){
  // Reconfirm a prior refusal on a new conversation; never carry a past bad
  // time forward as a permanent hold. Current refusals still stop immediately.
  for(const key of ['availability','interest','ownership'] as const)if(facts[key]===false)delete facts[key];
  const rows=object(conversation).transcript;if(!Array.isArray(rows))continue;
  let question='';
  for(let index=0;index<rows.length;index++){
   const row=object(rows[index]);if(typeof row.message!=='string')continue;
   const text=row.message.trim();
   if(row.role==='agent'){question=latestQualificationQuestion(text);continue;}
   if(row.role!=='user'||!answerable(text))continue;
   const ownerQuestion=/\b(?:owner|do you own|is (?:this|that|it|.+?) your property)\b/i.test(question)&&/\?/.test(question);
   const availabilityQuestion=/\b(?:good time|time to (?:talk|chat)|(?:have|got) (?:a (?:quick )?minute|a (?:couple|few) (?:of )?minutes))\b/i.test(question);
   const interestQuestion=/\b(?:interested in selling|(?:want|looking|ready|like) to sell|consider(?:ing)? selling)\b/i.test(question)&&/\?/.test(question);
   const situationQuestion=/\b(?:what(?:'s| is) going on|what.*(?:thinking|looking|want|decid)|why.*sell|reason.*sell|tell me.*situation)\b/i.test(question);
   if(ownerQuestion&&(yes.test(text)||no.test(text)))facts.ownership=!no.test(text);
   if(availabilityQuestion&&(yes.test(text)||no.test(text)))facts.availability=!no.test(text);
   if(availabilityQuestion&&/\b(?:not now|(?:can't|cannot) talk|not a good time|busy right now)\b/i.test(text))facts.availability=false;
   if(/\b(?:i(?:'m| am) (?:the |an? )?owner|i own (?:it|this|the (?:house|property)))\b/i.test(text))facts.ownership=true;
   if(/\b(?:not (?:the )?owner|don['’]?t own|do not own|wrong (?:number|person|property)|no longer own)\b/i.test(text))facts.ownership=false;
   if(sellerRequestsPrice(text)){
    facts.availability??=true;facts.interest??=true;
    // An offer question is not an answer to a pending repairs/occupancy question.
    question='';continue;
   }
   if(interestQuestion&&(yes.test(text)||no.test(text)))facts.interest=!no.test(text);
   if(/\b(?:(?:want|looking|ready|need|hoping|trying|plan|planning|like) to sell|interested in selling|(?:sell|selling) (?:it|my|the|this))\b/i.test(text))facts.interest=true;
   if(/\b(?:not (?:interested|looking|ready).*sell|don['’]?t want to sell|do not want to sell|not selling)\b/i.test(text))facts.interest=false;
   if(situationQuestion&&!/^(?:yes|no|yeah|nope)[.! ]*$/i.test(text)){facts.situation=true;facts.interest??=true;}
   if(/\b(?:moving|relocat\w*|inherited|inheritance|tired of|downsizing|too much (?:work|upkeep)|can['’]?t (?:afford|maintain)|rather not (?:say|discuss))\b/i.test(text))facts.situation=true;
   if(/\b(?:condition|repairs?|updates?|work.*need|need.*work|shape.*(?:house|property))\b/i.test(question))facts.condition=true;
   if(/\b(?:needs? (?:a |an |some |new |major |minor )?(?:roof|work|repairs?|updat\w*|ac|paint)|gutted|good (?:shape|condition)|bad condition|fixer|recently (?:renovated|remodeled))\b/i.test(text))facts.condition=true;
   if(/\b(?:(?:anyone|anybody|someone|who).*\bliv(?:e|es|ing)|occup(?:ied|ancy)|vacant|tenants?)\b/i.test(question))facts.occupancy=true;
   if(/\b(?:vacant|(?:no one|nobody|tenants?).*\bliv(?:e|es|ing)|i live|we live|rented out|unoccupied)\b/i.test(text))facts.occupancy=true;
   if(/\b(?:when.*(?:sell|clos|mov)|(?:selling|closing) (?:timeline|timeframe)|how (?:soon|quickly)|ideal.*(?:time|date))\b/i.test(question))facts.timing=true;
   if(/\b(?:next \w+ (?:days?|weeks?|months?)|as soon as possible|asap|no (?:rush|deadline)|(?:sell|close|move) (?:in|by|before|after|within))\b/i.test(text))facts.timing=true;
   const listing=sellerListingEvidence({transcript:rows.slice(0,index+1)},{action:'report_change',sellerStatement:text});
   if(listing!==null){facts.listing=true;listed=listing;}
   // A caller volunteering or answering property details is already conversing;
   // do not insert an unnecessary time-to-talk question on a return call.
   if(facts.availability===undefined&&(facts.situation||facts.condition||facts.occupancy||facts.timing))facts.availability=true;
  }
 }
 const missing=(Object.keys(questions) as Fact[]).filter(key=>facts[key]!==true);
 if(facts.ownership===false||facts.interest===false||facts.availability===false||listed===true)return {ready:false,missing,stop:true,nextQuestion:listed?'This property is listed with an agent. Do not quote an offer; follow the listing policy and end politely.':'The caller has declined this property discussion. Acknowledge and stop the pitch.'};
 return missing.length?{ready:false,missing,nextQuestion:questions[missing[0]]}:{ready:true};
}

export function sellerQualificationHold(result:Exclude<SellerQualification,{ready:true}>){
 return {quoteAllowed:false as const,priceCents:null,contractAllowed:false,sent:false,status:'qualification',reason:'seller_qualification_required',nextQuestion:result.nextQuestion,
  instruction:result.stop?result.nextQuestion:`This is a normal conversation step, not a failed calculation. No numerical offer is authorized yet. Briefly acknowledge the seller's last answer, introduce the saved company/principal if still missing, and ask only: "${result.nextQuestion}" Then listen. Do not retry the tool until they answer; do not invent facts or repeat completed questions.`,missing:result.missing};
}

type Db=<T>(path:string,method?:string,body?:unknown)=>Promise<T>;
/** Reuse real answers on return calls, scoped by server-resolved IDs. A reset
 * creates a new screening/deal, so the old property's answers cannot leak in. */
export async function boundSellerQualification(db:Db,context:{accountId?:string;dealId?:string;screeningId?:string;phone?:string},current:unknown){
 const first=sellerOfferQualification(current);if(first.ready||first.stop)return first;
 const {accountId,dealId,screeningId,phone}=context;
 if(!accountId||!dealId||!screeningId||!phone)return first;
 const [calls,threads]=await Promise.all([
  db<unknown[]>('rpc/icash_seller_prior_call_context','POST',{p_account:accountId,p_screening:screeningId,p_phone:phone}),
  db<{id:string}[]>(`icash_text_threads?account_id=eq.${accountId}&deal_id=eq.${dealId}&recipient=eq.${encodeURIComponent(phone)}&party=eq.seller&retired_at=is.null&select=id&limit=2`),
 ]);
 const history=Array.isArray(calls)?calls.map(c=>({at:String(object(c).completed_at??''),value:object(c).result})):[];
 if(threads.length===1){
  const messages=await db<{direction:string;body:string;created_at:string}[]>(`icash_text_messages?account_id=eq.${accountId}&thread_id=eq.${threads[0].id}&state=in.(accepted,sent,delivered,received)&select=direction,body,created_at&order=created_at.asc&limit=200`);
  let question='';
  for(const m of messages){
   if(m.direction==='outgoing'){question=m.body;continue;}
   if(m.direction==='incoming')history.push({at:m.created_at,value:{transcript:[{role:'agent',message:question},{role:'user',message:m.body}]}});
  }
 }
 history.sort((a,b)=>(Date.parse(a.at)||0)-(Date.parse(b.at)||0));
 return sellerOfferQualification(current,history.map(h=>h.value));
}
