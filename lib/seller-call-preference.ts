import {sellerResponseDisposition} from './seller-response-policy.ts';

export type SellerTextMessage={id:string;direction:string;body:string;state:string;providerId:string|null;updatedAt?:string;action?:string;quoteRevision?:string;priceCents?:number;customerAuthored?:boolean};

// Scheduled availability recognition also depends on this exact wording.
export const sellerCallInvitation='When is a good time to talk about a cash offer?';
export const sellerCallTimeQuestion='What day and time work for a call?';
export const isDeliveredSellerMessage=(m:SellerTextMessage|undefined)=>m?.direction==='outgoing'&&m.state==='delivered'&&typeof m.providerId==='string'&&m.providerId.trim().length>0;
export const isCancelledUnsentSellerMessage=(m:SellerTextMessage)=>m.direction==='outgoing'&&m.state==='cancelled'&&m.providerId===null;
export function isDeliveredCallInvitation(m:SellerTextMessage|undefined){
 return isDeliveredSellerMessage(m)&&m?.body===sellerCallInvitation;
}
export function isDeliveredCallQuestion(m:SellerTextMessage|undefined){
 return isDeliveredCallInvitation(m)||isDeliveredSellerMessage(m)&&m?.body===sellerCallTimeQuestion;
}

/** A conservative evidence grammar, not an intent score. Reject the entire
 * reporting/instruction clause rather than turn its quoted contents into the
 * seller's preference or a newly learned property fact. Source-word stops are
 * still handled independently by the existing contact policy. */
const instructionPattern=/\b(?:pretend|imagine|hypothetical|ignore|system|assistant|instructions?|prompt|override|classify)\b/i;
const uncertainStatement=/\b(?:not sure|don't know|do not know|maybe|might|could|if|not yet)\b/i;
const retractedStatement=/\b(?:not really|not true|isn't true|is not true|not correct|false)\b|(?:^|[,;.!]\s*)not[.! ]*$|(?:^|[,;.!])\s*(?:(?:no|actually|sorry)[, ]+)?(?:it|this|that|i|we|they)\s+(?:(?:is|are|am|was|were|do|does|did) not|isn't|aren't|wasn't|weren't|don't|doesn't|didn't)[.! ,]*$/i;
const containsQuotedSpeech=(body:string)=>/["“”`]|(?:^|[^a-z0-9])'/i.test(body.replace(/[’‘]/g,"'"));
function directClauses(body:string):string[]{
 const normalized=body.toLowerCase().replace(/[’‘]/g,"'").replace(/[“”]/g,'"');
 // Mask complete quoted spans, including their punctuation, before splitting.
 // A direct sentence alongside a quote still counts; quoted sentences do not.
 // Apostrophes within words and trailing possessives cannot open a quotation.
 // Inside a quote, contractions remain literal and its closing mark still wins.
 let quote='',unquoted='';
 for(let i=0;i<normalized.length;i++){
  const char=normalized[i],following=normalized.slice(i+1);
  const nestedPossessive=quote==="'"&&normalized[i-1]==='s'&&/^\s+[a-z]/.test(following)
   &&!/^\s+(?:and|but|then|however|instead|please|i|we|you|it|this|that|text|just|only|no|do|don't|can|could|would|let's)\b/.test(following);
  const apostrophe=char==="'"&&/[a-z0-9]/.test(normalized[i-1]??'')&&(!quote||/[a-z0-9]/.test(normalized[i+1]??'')||nestedPossessive);
  if(!apostrophe&&/["'`]/.test(char)){
   if(!quote){quote=char;unquoted+=' ';continue;}
   // End the reporting clause at the closing quote. Its punctuation was masked,
   // and must not swallow an independent direct preference that follows it.
   if(char===quote){quote='';unquoted+=';';continue;}
  }
  unquoted+=quote?' ':char;
 }
 return unquoted.split(/[.!?;\n]+/).flatMap(sentence=>{
  const direct:string[]=[];
  for(const clause of sentence.split(/\s*,\s*|\s+but\s+|\s+and\s+(?=(?:i |we |it |the |this |text |just |only ))/)){
   // Keep a completed direct preference before a reporting clause, but never
   // split "my tenant said, text only" into a new seller instruction afterward.
   if(/["\n]/.test(clause)||/(?:\b(?:said|says|saying|told|wrote|writes|asked|quoted|quote|example|phrase|pretend|imagine|hypothetical|ignore|system|assistant|instruction|prompt|override|classify)\b|\b(?:i|we) (?:do not|don't|did not|didn't|never) (?:say|mean|ask|request)\b)/.test(clause))break;
   direct.push(clause);
  }
  return direct;
 })
  .map(clause=>clause.trim().replace(/\s+/g,' ').replace(/^(?:please |okay[, ]+|ok[, ]+)/,'').replace(/\s+please$/,'')).filter(Boolean);
}

export function sellerSoftTextPreference(body:string):boolean{
 return directClauses(body).some(clause=>/^(?:(?:(?:i|we)(?:'d)? )?(?:prefer(?: to)?|would prefer(?: to)?|would rather|rather|(?:only )?want to) (?:keep )?text(?:ing)?|(?:just |only |let's (?:just )?|(?:can|could|would) (?:we|you) (?:just |only )?)?text(?: me| us)?|(?:i|we) can only text|text(?:ing)? only|(?:keep|stay|let's keep) (?:it |this )?(?:on|over|to|in) text|(?:keep|prefer) texting|(?:i |we )?(?:can't|cannot) (?:talk|take calls)|(?:i |we )?(?:would )?rather not (?:talk|call))(?: (?:for now|right now|now|at the moment|today|instead))?$/.test(clause));
}

export function sellerDirectTextDifficulty(body:string):boolean{
 // Mixed or partial quotation is insufficient for positive channel-need proof.
 // Direct preferences are parsed separately and still retain their restriction.
 if(containsQuotedSpeech(body)||instructionPattern.test(body)||retractedStatement.test(body)||uncertainStatement.test(body))return false;
 return directClauses(body).some(clause=>/^(?:(?:it(?:'s| is)|this(?: is)?|that(?:'s| is)|the (?:repairs?|condition|situation)(?: is| are)|(?:the )?repairs? (?:is|are)) (?:(?:really|very|too) )?(?:hard|difficult|complicated) to (?:explain|describe)(?: (?:it|this|the (?:repairs?|condition|situation)))? (?:by|over|in|through) text|(?:i|we) (?:can't|cannot) (?:explain|describe) (?:it|this|that|the (?:repairs?|condition|situation)) (?:by|over|in|through) text|(?:there(?:'s| is)|i have|we have) too much to (?:explain|describe) (?:by|over|in|through) text)$/.test(clause));
}

function firmCallPreference(body:string):boolean{
 return directClauses(body).some(clause=>/^(?:(?:no|never any) (?:more )?(?:calls|phone calls)|(?:do not|don't|never) (?:ever )?call(?: me| us)?(?: again)?|(?:do not|don't|never) ask(?: me| us)?(?: (?:about|for) (?:a )?call)?(?: again)?|(?:i |we )?(?:do not|don't) want (?:any |a |more )?(?:calls|phone calls))(?: (?:please|ever|again))?$/.test(clause));
}

function directCallRequest(body:string):boolean{
 return directClauses(body).some(clause=>/^(?:(?:(?:can|could|would|will) you )?call (?:me|us)(?: back)?(?:\b|$)|(?:i|we)(?:'d| would)? (?:want|prefer|like|need) (?:a )?(?:phone )?call\b|(?:let's|can we) (?:talk|speak) (?:by|on the) phone\b|call ?back$)/.test(clause));
}

function declinesDeliveredCall(body:string):boolean{
 const direct=body.trim().toLowerCase();
 // A leading direct No is the answer even when followed by a softer alternative.
 // Do not read a property fact such as "No one lives there" as that answer.
 if(/^(?:no|nope)(?:[.!;,]|\s*$)/.test(direct))return true;
 const alternative=direct.match(/^(?:no|nope)\s+(.+)$/)?.[1];
 return !!alternative&&sellerSoftTextPreference(alternative);
}

type PropertyFact='situation'|'condition'|'occupancy'|'timing'|'listing';
/** Only actual completed facts count. A question, unknown, summary, generic
 * reply or "hard to explain" does not complete a milestone. No turn threshold. */
function completedPropertyFacts(body:string,question:SellerTextMessage|undefined):PropertyFact[]{
 // Validate the entire statement before extracting a fact from a comma clause.
 // A later qualification/retraction must not leave its first assertion standing.
 if(body.includes('?')||containsQuotedSpeech(body)||instructionPattern.test(body)||retractedStatement.test(body)||uncertainStatement.test(body))return [];
 const facts=new Set<PropertyFact>();
 for(const text of directClauses(body)){
  // Movement of furniture, files or a legal motion is not a relocation. A
  // completed personal move may carry a destination, timeframe or work reason.
  if(/^(?:i(?:'m| am)|we(?:'re| are)) (?:moving|relocating)(?: (?:out(?: of (?:town|state|the area|(?:this|the) (?:house|home)))?|away|abroad|overseas|soon|(?:next|this) (?:week|month|year)|in (?:\d+|one|two|three|four|six) (?:days|weeks|months)|for (?:work|my job|a new job)|to (?!(?:dismiss|adjourn|table|approve|deny|accept|reject|pass|improve|get|make|keep|help|see|speak)\b)[a-z][a-z' -]{1,60}))?$/.test(text)
   ||/^(?:i(?:'m| am)|we(?:'re| are)) (?:downsizing|retiring)(?: (?:soon|(?:next|this) (?:week|month|year)|to a smaller (?:home|house|place)))?$/.test(text)
   ||/^(?:(?:i(?:'m| am)|we(?:'re| are)) tired of (?:the |this )?(?:upkeep|maintenance)|(?:i|we) (?:inherited (?:it|the (?:house|property)|(?:my|our) [a-z]+(?:'s|') (?:house|home|property))|can't (?:afford|maintain) (?:it|the (?:house|property))))$/.test(text))facts.add('situation');
  if(/^(?:(?:it|the (?:house|property)|my (?:house|property)) (?:needs? (?:a |an |some |new |major |minor )?(?:roof|work|repairs?|updates?|ac|paint)|is (?:in )?(?:good (?:shape|condition)|bad condition|gutted|recently (?:renovated|remodeled)))|(?:the |my )?roof (?:needs? (?:work|repair|replacement)|leaks))\b/.test(text))facts.add('condition');
  if(/^(?:(?:it|the (?:house|property)) is (?:vacant|unoccupied|rented out)|(?:i|we) live (?:there|in (?:it|the (?:house|property)))|(?:no one|nobody|tenants?) (?:is |are )?liv(?:es?|ing) there)\b/.test(text))facts.add('occupancy');
  if(/^(?:i|we) (?:want|need|plan|hope|would like) to (?:sell|close|move) (?:in|by|before|after|within) .+/.test(text)||/^(?:i|we) (?:have|am in|are in) no (?:rush|deadline)$/.test(text))facts.add('timing');
  if(/^(?:(?:it|the (?:house|property)) (?:is not|isn't|is) (?:currently )?listed(?: with (?:an? |a real estate )?agent)?|(?:i|we) (?:have|don't have|do not have) (?:an? |a real estate )?agent)$/.test(text))facts.add('listing');
  if(!isDeliveredSellerMessage(question))continue;
  // Short, concrete answers must follow their delivered question immediately.
  const q=question!.body;
  if(/\b(?:repairs?|updates?|condition)\b/i.test(q)&&/^(?:(?:a |new |some |major |minor )?(?:roof|paint|ac|repairs|updates)|good (?:shape|condition)|gutted|recently (?:renovated|remodeled))$/.test(text))facts.add('condition');
  if(/\b(?:anyone|anybody|occupancy|occupied|living|vacant|tenant)\b/i.test(q)&&/^(?:yes|no|vacant|unoccupied|rented out|tenants? (?:live|are living) there)$/.test(text))facts.add('occupancy');
  if(/\b(?:when.*(?:sell|close|move)|timeline|timeframe|how soon)\b/i.test(q)&&/^(?:(?:next|this) (?:week|month|year)|(?:within|in) (?:\d+|one|two|three|four|six) (?:days|weeks|months)|as soon as possible|asap|no rush|no deadline)$/.test(text))facts.add('timing');
  if(/\b(?:listed|listing|real estate agent)\b/i.test(q)&&/^(?:yes|no)$/.test(text))facts.add('listing');
 }
 return [...facts];
}

export type SellerCallPreference={mayInvite:boolean;mode:'initial'|'revisit'|'text';reason:string;preferenceSourceId?:string;progressSourceId?:string};
/** Derive from original source-prefix receipts only. This permits asking a
 * question, never a dial, consent change, campaign restart or price acceptance. */
export function sellerCallPreference(messages:SellerTextMessage[],sourceId:string):SellerCallPreference{
 const sourceIndex=messages.findIndex(m=>m.id===sourceId);
 const blocked=(reason:string):SellerCallPreference=>({mayInvite:false,mode:'text',reason});
 if(sourceIndex<0||messages.filter(m=>m.id===sourceId).length!==1)return blocked('source_required');
 const prefix=messages.slice(0,sourceIndex+1).filter(m=>!isCancelledUnsentSellerMessage(m));
 const source=prefix.at(-1)!;
 if(source.direction!=='incoming'||source.state!=='received')return blocked('source_required');
 let preferenceIndex=-1,preferenceSourceId:string|undefined,progressSourceId:string|undefined;
 let invitations=0,unanswered=false,revisited=false,firm=false,requested=false;
 const completed=new Set<PropertyFact>();
 for(let index=0;index<prefix.length;index++){
  const m=prefix[index],previous=prefix[index-1];
  if(m.direction==='outgoing'){
   if(!isDeliveredSellerMessage(m))return blocked('outgoing_receipt_unresolved');
   if(m.action==='invite_call'||m.action==='invite_call_time'||isDeliveredCallQuestion(m)||/\b(?:when|what (?:date|day|time)|good time|available).*\b(?:call|talk)\b|\bcan (?:i|we) call\b/i.test(m.body)){
    // The time clarification is the same invitation, not a new solicitation.
    if(m.body!==sellerCallTimeQuestion){invitations++;if(preferenceIndex>=0)revisited=true;}
    unanswered=true;
   }
   continue;
  }
  if(m.direction!=='incoming'||m.state!=='received')continue;
  if(sellerResponseDisposition(m.body)!==null||firmCallPreference(m.body))firm=true;
  // The separate source-bound request workflow owns explicit call requests.
  // Never replace one with another unsolicited invitation or infer a booking.
  if(directCallRequest(m.body))requested=true;
  if(isDeliveredCallQuestion(previous)&&declinesDeliveredCall(m.body)){firm=true;unanswered=false;}
  const soft=sellerSoftTextPreference(m.body);
  if(soft){
   // A renewed preference does not earn a new attempt or reset progress.
   if(revisited)firm=true;
   preferenceIndex=index;preferenceSourceId=m.id;progressSourceId=undefined;
   if(isDeliveredCallQuestion(previous))unanswered=false;
  }
  for(const fact of completedPropertyFacts(m.body,previous)){
   if(!completed.has(fact)&&preferenceIndex>=0&&index>preferenceIndex)progressSourceId=m.id;
   completed.add(fact);
  }
 }
 if(firm)return blocked('seller_refusal');
 if(requested)return blocked('seller_requested_call');
 if(unanswered)return blocked('invitation_unanswered');
 if(revisited||invitations>=2)return blocked('revisit_used');
 if(preferenceIndex<0)return invitations===0?{mayInvite:true,mode:'initial',reason:'initial_invitation'}:blocked('invitation_already_sent');
 if(!progressSourceId||preferenceSourceId===source.id||!sellerDirectTextDifficulty(source.body))return blocked('text_preference');
 return {mayInvite:true,mode:'revisit',reason:'seller_progress_and_text_difficulty',preferenceSourceId,progressSourceId};
}
