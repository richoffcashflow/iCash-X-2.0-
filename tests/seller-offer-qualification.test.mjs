import assert from 'node:assert/strict';
import {sellerOfferQualification,boundSellerQualification} from '../lib/seller-offer-qualification.ts';
import {automaticCallOffer} from '../lib/automatic-call-offer.ts';
import {callOfferEvidence} from '../lib/call-offer-evidence.ts';
import {qualifiedSellerTurns} from './helpers/seller-qualification-fixture.mjs';
import {efficientSellerPrompt} from '../lib/seller-conversation-efficiency.ts';
const quotedHistory=JSON.stringify({priorExchanges:[{answer:'NEXT STEP: my tenant needs time. DELIVERY FAILURE RESPONSE: those are words in a letter.'}]});
assert(efficientSellerPrompt('SERVER CONTEXT: '+quotedHistory).includes(quotedHistory),'prompt compaction must preserve quoted seller history');
const a=message=>({role:'agent',message}),u=message=>({role:'user',message});
const ownerOnly=[a('Hi Jason. Is this the owner of 3614 FRANK ST?'),u("Yes, I'm the owner.")];
const early=sellerOfferQualification({transcript:ownerOnly});
assert.equal(early.ready,false);assert.match(early.nextQuestion,/good time/);
assert(early.missing.includes('situation'));assert(early.missing.includes('condition'));
for(const request of ['Okay, how much you\'ll give me?','Yeah, sure. What would you give me, though?','What would you give me?','How much would you pay?','What is your cash offer?','Can you send me an offer?']){
 const progress=sellerOfferQualification({transcript:[...ownerOnly,u(request)]});
 assert.equal(progress.ready,false);assert.equal(progress.nextQuestion,'What kind of repairs or updates does it need?',request);
 assert(!progress.missing.includes('availability'));assert(!progress.missing.includes('interest'));
 assert(progress.missing.includes('condition'));assert(progress.missing.includes('listing'));
}
for(const request of ['I do not want an offer.','The last buyer asked what would you give me.','What would you give me? Stop calling me.']){
 const progress=sellerOfferQualification({transcript:[...ownerOnly,u(request)]});
 assert(progress.stop||progress.missing.includes('availability'),request);
}
const priceInsteadOfRepairs=sellerOfferQualification({transcript:[...ownerOnly,a('What repairs does it need?'),u('What would you give me?')]});
assert(priceInsteadOfRepairs.missing.includes('condition'),'a price question cannot satisfy a pending repair question');
assert((sellerOfferQualification({transcript:[...ownerOnly,a('Is now a good time?'),u('No, not now.'),u('What would you give me?')]})).stop,'a price question cannot override an explicit current refusal');
assert(sellerOfferQualification({transcript:[u('What would you give me?')]}).missing.includes('ownership'),'a price request cannot establish ownership');
assert.equal(sellerOfferQualification({transcript:qualifiedSellerTurns}).ready,true);
for(const question of ['Are you the only owner?','Are you the sole owner and decision maker?','Is there another owner?','Are there any other owners?']){
 const sharedOwnership={transcript:[...qualifiedSellerTurns,a(question),u('No, um, no.')]};
 assert.equal(sellerOfferQualification(sharedOwnership).ready,true,'a co-owner answer must not revoke confirmed ownership: '+question);
 assert.equal(sellerOfferQualification({transcript:[...sharedOwnership.transcript,u('I am not the owner; wrong person.')]}).stop,true,'explicit ownership denial still stops');
}
// Anonymized November 4 call: the natural unlisted answer was discarded,
// which sent the caller back through already answered repair/listing questions.
const novemberReplay=[
 a('Is this the owner of 123 Example Drive?'),u('Yes.'),
 a('Would you be interested in selling your property for all cash?'),u('Yes. How much can you give me?'),
 a('One moment. Thanks for letting me know. What has you thinking about selling the property?'),u("Yes, I'm just... I just want to get rid of the property. I mean, you know, it's been in bad condition and, you know, I just want to get rid of it."),
 a('Can you tell me what kind of repairs or updates the property needs?'),u("Yeah, so the property is, like, almost gutted. I haven't lived in there in, like, over 20 years, and it's just sitting up. It's vacant. Um, yeah, I just wanna get rid of it."),
 a('When are you hoping to sell the property?'),u('I wanna sell within the next 30 days, as soon as possible.'),
 a('Is the property currently listed with a real estate agent?'),u("No, it's not."),
];
assert.deepEqual(sellerOfferQualification({transcript:novemberReplay}),{ready:true},'the first natural listing answer completes qualification');
novemberReplay.push(a('Does anyone else own the property with you who would need to agree to sell?'),u('No, um, no.'));
assert.deepEqual(sellerOfferQualification({transcript:novemberReplay}),{ready:true},'the co-owner answer retains prior condition, occupancy, timing and listing evidence');
novemberReplay.push(a('Just to be sure, does the property need any specific repairs or updates beyond being gutted? If you have an estimated total repair cost, that would help too.'),u('No, I, I told you everything. I told you all the repairs that it needs.'));
assert.deepEqual(sellerOfferQualification({transcript:novemberReplay}),{ready:true},'no extra repairs does not restart qualification');
// The October 13 call repeated this answer until the caller finally said "vacant".
for(const [question,answer] of [
 ['Does anyone currently live in the property?','No one lives in the property.'],
 ['Is anyone living in the property right now?','No.'],
 ['Who lives there?','My brother.'],
 ['Is anybody living there?','I do not know.'],
 ['Anything else about the property?','Nobody lives there.'],
 ['Anything else about the property?','No one is living in the house.'],
 ['Anything else about the property?','My tenants live there.'],
]){
 const result=sellerOfferQualification({transcript:[a(question),u(answer)]});
 assert.equal(result.ready,false,'occupancy alone cannot authorize an offer');
 assert(!result.missing.includes('occupancy'),answer);
}
for(const answer of ['Pardon?','I did not understand.']){
 const result=sellerOfferQualification({transcript:[a('Does anyone currently live there?'),u(answer)]});
 assert(result.missing.includes('occupancy'),'a request to repeat is not an occupancy answer');
}
for(const [question,answer] of [['Is this the owner of 45 Fixture Lane?','No, wrong person.'],['Are you looking to sell?','No, not interested.'],['Is now a good time?','No, I am busy.'],['Is it listed with an agent?','Yes.']]){
 const result=sellerOfferQualification({transcript:[...qualifiedSellerTurns,a(question),u(answer)]});assert.equal(result.ready,false);assert.equal(result.stop,true,answer);
}
const unknowns=qualifiedSellerTurns.map(turn=>turn.role==='user'&&/moving|roof|30 days/.test(turn.message)?u("I'd rather not say; I don't know yet."):turn);
assert.equal(sellerOfferQualification({transcript:unknowns}).ready,true,'explicit unknowns/refusals do not repeat personal questions');
assert.equal(sellerOfferQualification({transcript:ownerOnly},[{summary:'Seller is motivated, house vacant, needs roof, ready in 30 days.'}]).ready,false,'summaries cannot fabricate seller answers');
assert.equal(sellerOfferQualification({transcript:ownerOnly},[{transcript:[...ownerOnly,a('We can offer $60,000 cash. Does that work?')]}]).ready,false,'the premature quote does not count as qualification');
assert.equal(sellerOfferQualification({transcript:[u('I am calling back.')]},[{transcript:qualifiedSellerTurns}]).ready,true,'real bound history preserves answers');
assert.equal(sellerOfferQualification({transcript:qualifiedSellerTurns},[{transcript:[...ownerOnly,a('Is now a good time?'),u('No, not now.')]}]).ready,true,'a prior bad time does not block a later conversation');
assert.equal(sellerOfferQualification({transcript:[...qualifiedSellerTurns,a('Is now a good time?'),u('Not now.')]}).stop,true);

const now=Date.now(),snapshot={propertyId:'prop_127921557',propertyType:'house',fetchedAt:new Date(now).toISOString(),sellerCostReserveCents:0,raw:{data:{dm_property_id:'prop_127921557',full_address:'3614 FRANK ST',estimated_value:167000,estimated_repair_cost:46270,total_estimated_loan_balance:0,estimated_equity_percentage:100}}};
let context={party:'seller',address:'3614 FRANK ST',snapshot,offerState:{},offerVersion:0},turns=ownerOnly,saves=0;
const d={now:()=>now,bind:async()=>{},verifyQualification:async()=>sellerOfferQualification({transcript:turns}),verifyInput:async i=>callOfferEvidence({transcript:turns},i),db:async(path,method,body)=>{
 if(path==='rpc/icash_call_offer_context')return structuredClone(context);
 assert.equal(path,'rpc/icash_save_call_offer');context.offerState=body.p_state;context.offerVersion++;saves++;return true;
}};
const call=(action,extra={})=>automaticCallOffer('a'.repeat(64),{action,conversationId:'conv_fixture',...extra},d);
const held=await call('get_offer');assert.equal(held.quoteAllowed,false);assert.equal(held.priceCents,null);assert.equal(saves,0);
const {verifyQualification,...withoutVerifier}=d;
assert.equal((await automaticCallOffer('a'.repeat(64),{action:'get_offer',conversationId:'conv_fixture'},withoutVerifier)).quoteAllowed,false,'missing qualification verifier fails closed');
assert(!JSON.stringify(held).includes('74000'),'no price leaks in other response fields');
turns=[...ownerOnly,a('What repairs are needed?'),u('The roof needs replacement.')];
const repair=await call('update_repairs',{sellerStatement:'The roof needs replacement.'});
assert.equal(repair.quoteAllowed,false);assert.equal(repair.factsSaved,true);assert.equal(context.offerState.sellerStatement,'The roof needs replacement.');
assert.equal(repair.priceCents,null,'recording repairs cannot skip the remaining conversation');
const beforeTiming=qualifiedSellerTurns.filter((_,i)=>i!==12&&i!==13);
turns=beforeTiming;
assert.equal((await call('get_offer')).quoteAllowed,false);
turns=[...beforeTiming,u('I want $80,000 for the property.')];
assert.equal((await call('get_offer')).quoteAllowed,false,'a seller asking price is not a request for our quote');
const historical=sellerOfferQualification({transcript:beforeTiming},[{transcript:[u('How much is the offer?')]}]);
assert.equal(historical.priceRequested,undefined,'an earlier call cannot request a quote on behalf of the current speaker');
for(const request of ['How much is the offer?','Could you tell me the offer?']){
 turns=[...beforeTiming,u(request)];
 const requested=await call('get_offer');
 assert.equal(requested.quoteAllowed,true);assert.equal(requested.priceCents,6000000);assert.equal(requested.contractAllowed,false);
 turns=[...turns,a('We can offer $60,000 cash. Does that work?'),u('Yes.')];
 assert.equal((await call('accept_offer',{priceCents:requested.priceCents,quoteRevision:requested.quoteRevision})).quoteAllowed,false);
}
turns=qualifiedSellerTurns;const quote=await call('get_offer');assert.equal(quote.quoteAllowed,true);assert.equal(quote.priceCents,6000000);
turns=[...turns,a('We can offer $60,000 cash. Does that work?'),u('Yes.')];
assert.equal((await call('accept_offer',{priceCents:quote.priceCents,quoteRevision:quote.quoteRevision})).status,'verbally_accepted');
turns=[];assert.equal((await call('get_offer')).status,'verbally_accepted','accepted deal resumes closing rather than asking qualification again');
context={party:'buyer',buyer:{askingPriceCents:8400000,address:'3614 FRANK ST'}};
assert.equal((await call('get_offer')).priceCents,8400000,'buyer inquiry does not run seller questions');

const scoped={accountId:'account',dealId:'new-deal',screeningId:'new-screen',phone:'+12125550199'};
let existingCalls=[];
const read=async(path,method,input)=>{
 if(path==='rpc/icash_seller_memory_context')return null;
 if(path==='rpc/icash_seller_prior_call_context'){assert.deepEqual(input,{p_account:'account',p_screening:'new-screen',p_phone:scoped.phone});return existingCalls;}
 assert.match(path,/deal_id=eq.new-deal/);assert.match(path,/retired_at=is.null/);return [];
};
assert.equal((await boundSellerQualification(read,scoped,{transcript:ownerOnly})).ready,false,'new lead cannot reuse archived Frank St history');
existingCalls=[{result:{transcript:qualifiedSellerTurns}}];
assert.equal((await boundSellerQualification(read,scoped,{transcript:ownerOnly})).ready,true,'returning seller uses the exact new lead history');
const smsRead=async(path,method,input)=>{
 if(path==='rpc/icash_seller_memory_context')return null;
 if(path==='rpc/icash_seller_prior_call_context')return [];
 if(path.startsWith('icash_text_threads?'))return [{id:'new-thread'}];
 if(path.startsWith('icash_text_events?'))return qualifiedSellerTurns.flatMap((t,i)=>t.role==='user'?[{id:'event-'+i,type:'text.incoming.sms',source_time:(now-10000+i*100)/1000}]:[]);
 assert.match(path,/thread_id=eq.new-thread/);assert.match(path,/account_id=eq.account/);
 return qualifiedSellerTurns.map((t,i)=>({id:String(i).padStart(4,'0'),direction:t.role==='user'?'incoming':'outgoing',body:t.message,state:t.role==='user'?'received':'delivered',provider_id:'provider-'+i,event_id:t.role==='user'?'event-'+i:null,last_delivery_at:new Date(now-10000+i*100+1).toISOString(),created_at:new Date(now-10000+i*100).toISOString()}));
};
assert.equal((await boundSellerQualification(smsRead,scoped,{transcript:ownerOnly})).ready,true,'bound actual SMS answers also avoid repeating qualification');

// The legacy path is still used outside the separately activated memory cohort.
// Unconfirmed outgoing questions cannot turn an unrelated "yes" into ownership.
const withoutOwnership={transcript:qualifiedSellerTurns.slice(2)};
const historyAt=Date.parse('2026-11-16T18:00:00Z');
const historyRow=(index,direction,body,extra={})=>({id:String(index).padStart(4,'0'),account_id:scoped.accountId,thread_id:'new-thread',direction,body,
 state:direction==='incoming'?'received':'delivered',provider_id:'provider-'+index,event_id:direction==='incoming'?'event-'+index:null,
 last_delivery_at:direction==='outgoing'?new Date(historyAt+index*1000+100).toISOString():null,created_at:new Date(historyAt+index*1000).toISOString(),...extra});
let legacyRows=[],legacyCalls=[],legacyQueries=[],eventQueries=[],eventOverrides=new Map();
const legacyRead=async(path,method,input)=>{
 if(path==='rpc/icash_seller_memory_context'){assert.equal(method,'POST');return null;}
 if(path==='rpc/icash_seller_prior_call_context'){assert.equal(method,'POST');assert.deepEqual(input,{p_account:scoped.accountId,p_screening:scoped.screeningId,p_phone:scoped.phone});return legacyCalls;}
 const params=new URL('https://fixture.invalid/'+path).searchParams;
 assert.equal(method,undefined,'the fallback only reads its saved history');
 if(path.startsWith('icash_text_events?')){
  eventQueries.push(path);assert.equal(params.get('select'),'id,type,source_time:payload->timestamp');assert.equal(params.get('limit'),'25');
  const ids=JSON.parse('['+params.get('id').slice(4,-1)+']');assert(ids.length<=25);
  return legacyRows.filter(row=>ids.includes(row.event_id)).flatMap(row=>eventOverrides.get(row.event_id)===null?[]:[{id:row.event_id,type:'text.incoming.sms',source_time:Date.parse(row.created_at)/1000,...eventOverrides.get(row.event_id)}]);
 }
 assert.equal(params.get('account_id'),'eq.'+scoped.accountId);
 if(path.startsWith('icash_text_threads?')){
  assert.equal(params.get('deal_id'),'eq.'+scoped.dealId);assert.equal(params.get('recipient'),'eq.'+scoped.phone);
  assert.equal(params.get('party'),'eq.seller');assert.equal(params.get('retired_at'),'is.null');return [{id:'new-thread'}];
 }
 assert(path.startsWith('icash_text_messages?'));assert.equal(params.get('thread_id'),'eq.new-thread');legacyQueries.push(path);
 const states=params.get('state')?.match(/^in\.\((.+)\)$/)?.[1].split(',');
 return legacyRows.filter(row=>row.account_id===scoped.accountId&&row.thread_id==='new-thread'&&(!states||states.includes(row.state)))
  .sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id)).slice(0,Number(params.get('limit')));
};
const qualifyLegacy=()=>boundSellerQualification(legacyRead,scoped,withoutOwnership);
for(const state of ['accepted','dispatching','ready','needs_review','cancelled']){
 legacyRows=[historyRow(1,'outgoing','Are you the owner of this property?',{state}),historyRow(2,'incoming','Yes.')];
 const result=await qualifyLegacy();assert.equal(result.ready,false,state+' does not establish a delivered ownership question');assert(result.missing.includes('ownership'));
}
legacyRows=[historyRow(1,'outgoing','Are you the owner of this property?',{provider_id:null}),historyRow(2,'incoming','Yes.')];
assert((await qualifyLegacy()).missing.includes('ownership'),'delivered state without an original provider identity is insufficient');
legacyRows=[historyRow(1,'outgoing','Are you the owner of this property?'),historyRow(2,'incoming','Yes.')];
assert.equal((await qualifyLegacy()).ready,true,'exact delivered and received sources preserve the answer');
legacyRows[1].provider_id=null;
assert.equal((await qualifyLegacy()).ready,true,'the authenticated incoming event identity can establish receipt without a provider message ID');
for(const extra of [{last_delivery_at:null},{last_delivery_at:new Date(historyAt+2000).toISOString()},{last_delivery_at:new Date(historyAt+3000).toISOString()}]){
 legacyRows=[historyRow(1,'outgoing','Are you the owner of this property?',extra),historyRow(2,'incoming','Yes.')];
 assert((await qualifyLegacy()).missing.includes('ownership'),'missing, tied, or later delivery cannot retroactively establish the question');
}
legacyRows=[historyRow(1,'outgoing','Are you the owner of this property?'),historyRow(3,'incoming','Yes.')];
eventOverrides.set('event-3',{source_time:(historyAt+500)/1000});
assert((await qualifyLegacy()).missing.includes('ownership'),'delayed incoming ingestion cannot turn an earlier yes into a reply to a newer question');
for(const event of [null,{source_time:null},{source_time:'invalid'},{source_time:-1},{source_time:(Date.now()+600000)/1000},{type:'text.delivery.confirmed'}]){
 eventOverrides.set('event-3',event);assert((await qualifyLegacy()).missing.includes('ownership'),'ambiguous answers need an original valid incoming event time');
 legacyRows[1].body='I own the property.';assert.equal((await qualifyLegacy()).ready,true,'self-contained source statements do not need a question binding');legacyRows[1].body='Yes.';
}
eventOverrides.clear();

for(const extra of [{state:'needs_review'},{provider_id:null,event_id:null}]){
 legacyRows=[historyRow(1,'outgoing','Are you the owner of this property?'),historyRow(2,'incoming','Yes.',extra)];
 assert((await qualifyLegacy()).missing.includes('ownership'),'unverified incoming row is not an answer');
}
legacyRows=[historyRow(1,'outgoing','Are you the owner of this property?'),historyRow(2,'outgoing','Is anyone living there?',{state:'accepted'}),historyRow(3,'incoming','Yes.')];
assert((await qualifyLegacy()).missing.includes('ownership'),'unconfirmed intervening question clears the previous question instead of misbinding yes');
legacyRows=[historyRow(1,'outgoing','Are you the owner of this property?'),historyRow(2,'incoming','Yes.',{created_at:new Date(historyAt+1000).toISOString()})];
assert((await qualifyLegacy()).missing.includes('ownership'),'an equal-time row does not establish question-before-answer order');
legacyRows=[historyRow(1,'outgoing','Are you the owner of this property?'),historyRow(2,'incoming','Yes.'),historyRow(3,'outgoing','Is anyone living there?',{created_at:new Date(historyAt+2000).toISOString()})];
assert((await qualifyLegacy()).missing.includes('ownership'),'a same-time outgoing boundary cannot be put after the answer by an arbitrary UUID');
legacyRows=[historyRow(1,'outgoing','Are you the owner of this property?'),historyRow(2,'incoming','I no longer own it.'),historyRow(3,'incoming','Yes.',{created_at:new Date(historyAt+2000).toISOString()})];
assert.equal((await qualifyLegacy()).stop,true,'simultaneous conflicting answers require ordering evidence rather than UUID precedence');
legacyRows=[historyRow(2,'incoming','Yes.'),historyRow(1,'outgoing','Are you the owner of this property?')];
assert.equal((await qualifyLegacy()).ready,true,'the request orders original timestamps before binding answers');
legacyRows.push(historyRow(3,'incoming','I no longer own the property.'));
assert.equal((await qualifyLegacy()).stop,true,'a later correction supersedes the earlier delivered answer');
legacyRows=[historyRow(1,'outgoing','Are you the owner of this property?'),historyRow(2,'incoming','Yes.',{account_id:'other-account'})];
assert((await qualifyLegacy()).missing.includes('ownership'),'a shared phone does not import another account answer');
legacyRows=[historyRow(1,'outgoing','Are you the owner of this property?'),historyRow(2,'incoming','Yes.',{thread_id:'other-thread'})];
assert((await qualifyLegacy()).missing.includes('ownership'),'a different thread cannot fill the answer');
legacyCalls=[{completed_at:new Date(historyAt-1000).toISOString(),result:{transcript:qualifiedSellerTurns}}];
legacyRows=[historyRow(1,'outgoing','Are you the owner of this property?',{state:'accepted'}),historyRow(2,'incoming','Yes.')];
assert.equal((await qualifyLegacy()).ready,true,'valid completed call evidence is retained independently of an unconfirmed text question');
legacyCalls=[];
legacyRows=[historyRow(1,'outgoing','Are you the owner of this property?'),historyRow(2,'incoming','Yes.'),...Array.from({length:198},(_,i)=>historyRow(i+3,'outgoing','Information only.'))];
assert.equal((await qualifyLegacy()).ready,true,'a complete 200-row history is still supported');
legacyRows.push(historyRow(201,'incoming','I no longer own the property.'));
let overflow=await qualifyLegacy();assert.equal(overflow.ready,false);assert.equal(overflow.stop,true);assert.match(overflow.nextQuestion,/full saved conversation.*reconciliation/i);
legacyRows.pop();assert.equal((await qualifyLegacy()).ready,true,'no stale incomplete-history decision is cached');
legacyRows.push(historyRow(201,'outgoing','Are you the owner?',{state:'ready'}));
overflow=await qualifyLegacy();assert.equal(overflow.ready,false,'unsent boundaries also count toward the history cap');
assert.equal((await boundSellerQualification(legacyRead,scoped,{transcript:[u('I no longer own this property.')]})).stop,true,'an explicit current refusal still stops before capped history');
legacyRows=Array.from({length:200},(_,i)=>historyRow(i+1,'incoming','Information only.'));
const beforeBatch=eventQueries.length;assert((await qualifyLegacy()).missing.includes('ownership'));assert.equal(eventQueries.length-beforeBatch,8,'200 original event projections stay bounded to eight 25-ID requests');
legacyRows=[historyRow(1,'outgoing','Are you the owner of this property?'),historyRow(2,'incoming','I no longer own it.'),historyRow(3,'incoming','Yes.')];
eventOverrides.set('event-2',{source_time:(historyAt+4000)/1000});
assert.equal((await qualifyLegacy()).stop,true,'original incoming event order wins over ingestion order for an ownership correction');
eventOverrides.clear();
for(const query of legacyQueries){assert.match(query,/select=[^&]*state/);assert.match(query,/select=[^&]*provider_id/);assert.match(query,/select=[^&]*event_id/);assert.match(query,/select=[^&]*last_delivery_at/);assert.match(query,/order=created_at.asc,id.asc/);assert.match(query,/limit=201/);assert(!query.includes('state=in.'));}
// A complete current transcript cannot bypass a newer, source-backed SMS refusal.
const liveScope={...scoped,conversationId:'conv_legacyOrder'};
const timedCurrent={conversation_id:liveScope.conversationId,metadata:{start_time_unix_secs:historyAt/1000},transcript:qualifiedSellerTurns.map((t,i)=>({...t,time_in_call_secs:i*2}))};
let freshReads=0;
const freshCurrent=async()=>{freshReads++;return structuredClone(timedCurrent);};
legacyRows=[historyRow(100,'incoming','I do not want to sell the property.')];
assert.equal((await boundSellerQualification(legacyRead,liveScope,timedCurrent,freshCurrent)).stop,true,'a refusal after the last heard qualifying answer defeats the fully-qualified legacy shortcut');
assert.equal(freshReads,1,'only the existing bounded current-conversation callback is needed');
const appendTimed=(message,seconds=110)=>({...structuredClone(timedCurrent),transcript:[...structuredClone(timedCurrent.transcript),{role:'user',message,time_in_call_secs:seconds}]});
assert.equal((await boundSellerQualification(legacyRead,liveScope,timedCurrent,async()=>appendTimed('Okay.'))).stop,true,'later filler cannot supersede an earlier answer with a new refusal');
assert.equal((await boundSellerQualification(legacyRead,liveScope,timedCurrent,async()=>appendTimed('I want to sell the property.'))).ready,true,'an exact fresh later explicit spoken correction may restore qualification');
assert.equal((await boundSellerQualification(legacyRead,liveScope,timedCurrent,async()=>appendTimed('I want to sell the property.',100))).stop,true,'equal event and qualifying-answer times do not establish a correction');
legacyRows=[historyRow(1,'incoming','I do not want to sell the property.')];
assert.equal((await boundSellerQualification(legacyRead,liveScope,timedCurrent,freshCurrent)).ready,true,'an SMS during the call but before the actual interest answer does not override that later spoken answer');
legacyRows=[historyRow(100,'incoming','I no longer own the property.')];
assert.equal((await boundSellerQualification(legacyRead,liveScope,timedCurrent,async()=>appendTimed('I want to sell the property.'))).stop,true,'later interest does not correct a newer ownership denial');
assert.equal((await boundSellerQualification(legacyRead,liveScope,timedCurrent,async()=>appendTimed('I own the property.'))).ready,true,'later explicit ownership corrects the exact conflicting fact');
legacyRows=[historyRow(100,'incoming','The property is listed with an agent.')];
assert.equal((await boundSellerQualification(legacyRead,liveScope,timedCurrent,freshCurrent)).stop,true,'a newer listing blocks the old unlisted answer');
assert.equal((await boundSellerQualification(legacyRead,liveScope,timedCurrent,async()=>appendTimed('The property is not listed with an agent.'))).ready,true,'a proven later unlisted correction follows the existing listing policy');
for(const message of ['STOP','Please hold off.','Never mind.']){
 legacyRows=[historyRow(100,'incoming',message)];let read=0;
 assert.equal((await boundSellerQualification(legacyRead,liveScope,timedCurrent,async()=>{read++;return appendTimed('I want to sell the property.');})).stop,true,message+' is not erased by a qualification correction');assert.equal(read,0);
}
legacyRows=[historyRow(100,'incoming','I do not want to sell the property.')];
const corrected=()=>appendTimed('I want to sell the property.');
for(const change of [
 value=>({...value,conversation_id:'conv_other'}),value=>({...value,metadata:{start_time_unix_secs:historyAt/1000-86400}}),value=>({...value,metadata:{}}),value=>({...value,metadata:{start_time_unix_secs:Date.now()/1000+100}}),
 value=>({...value,transcript:value.transcript.map(t=>t.role==='user'?{...t,time_in_call_secs:undefined}:t)}),
 value=>({...value,transcript:[...value.transcript.slice(0,-1),{...value.transcript.at(-1),time_in_call_secs:601}]}),
 value=>({...value,transcript:[...value.transcript,{role:'user',message:'Okay.',time_in_call_secs:5}]}),
 value=>({...value,transcript:value.transcript.map((t,i)=>i===0?{...t,message:'Are you the tenant?'}:t)}),
])assert.equal((await boundSellerQualification(legacyRead,liveScope,timedCurrent,async()=>change(corrected()))).stop,true,'wrong/stale/missing/reversed/future timing cannot prove a later correction');
assert.equal((await boundSellerQualification(legacyRead,liveScope,timedCurrent,async()=>{throw Error('offline unavailable');})).stop,true,'a failed current transcript read preserves the refusal');
const notCaughtUp=appendTimed('I would like the next step.',90);
assert.equal((await boundSellerQualification(legacyRead,liveScope,notCaughtUp,freshCurrent)).stop,true,'the provider transcript must contain all supplied current turns');
for(const event of [null,{source_time:null}]){
 eventOverrides.set('event-100',event);
 assert.equal((await boundSellerQualification(legacyRead,liveScope,timedCurrent,async()=>corrected())).stop,true,'unknown original SMS timing cannot authorize a reversal');
}
eventOverrides.clear();
eventOverrides.set('event-100',{source_time:historyAt/1000+110.0008});
assert.equal((await boundSellerQualification(legacyRead,liveScope,timedCurrent,async()=>appendTimed('I want to sell the property.',110.0001))).stop,true,'sub-millisecond source ties are unknown rather than ordered by insertion');
eventOverrides.clear();
assert.equal((await boundSellerQualification(legacyRead,liveScope,timedCurrent,async()=>{legacyRows.push(historyRow(120,'incoming','I no longer own it.'));return corrected();})).stop,true,'a new text during current transcript retrieval invalidates the snapshot');
legacyRows=[historyRow(100,'incoming','I do not want to sell the property.')];
let threadReads=0;
const changedThread=async(path,...args)=>path.startsWith('icash_text_threads?')&&++threadReads>1?[{id:'new-thread'},{id:'other-active'}]:legacyRead(path,...args);
assert.equal((await boundSellerQualification(changedThread,liveScope,timedCurrent,async()=>corrected())).stop,true,'a changed active thread set cannot be ignored during reconciliation');
legacyRows=[];freshReads=0;
assert.equal((await boundSellerQualification(legacyRead,liveScope,timedCurrent,freshCurrent)).ready,true);assert.equal(freshReads,0,'a complete current answer without conflicting SMS needs no provider reread');
for(const mode of ['multiple_threads','thread_failure','message_failure','capped']){
 legacyRows=mode==='capped'?Array.from({length:201},(_,i)=>historyRow(i+1,'outgoing','Information only.')):[];
 const broken=async(path,...args)=>{
  if(path.startsWith('icash_text_threads?')&&mode==='multiple_threads')return [{id:'new-thread'},{id:'other-active'}];
  if(path.startsWith('icash_text_threads?')&&mode==='thread_failure'||path.startsWith('icash_text_messages?')&&mode==='message_failure')throw Error('offline unavailable');
  return legacyRead(path,...args);
 };
 assert.equal((await boundSellerQualification(broken,liveScope,timedCurrent,freshCurrent)).stop,true,mode+' cannot silently bypass the full-current source check');
}

legacyRows=[historyRow(100,'incoming','I do not want to sell the property.')];
for(const extra of [{at:new Date(historyAt+110000).toISOString()},{seconds:110}]){
 const aliased={...structuredClone(timedCurrent),transcript:timedCurrent.transcript.map(t=>t.role==='user'?{...t,...extra}:t)};
 assert.equal((await boundSellerQualification(legacyRead,liveScope,timedCurrent,async()=>aliased)).stop,true,'unvalidated at/seconds aliases cannot move an earlier answer past a newer refusal');
}
for(const identity of ["I'm just the tenant.","I'm his wife.",'This is his daughter.']){
 legacyRows=[historyRow(100,'incoming',identity)];
 for(const current of [timedCurrent,{...timedCurrent,transcript:timedCurrent.transcript.slice(2)}]){
  const result=await boundSellerQualification(legacyRead,liveScope,current,async()=>structuredClone(current));
  assert.equal(result.ready,false,identity+' invalidates the previous speaker facts');assert.equal(result.stop,true,'accepted-price continuity cannot bypass unresolved speaker identity');assert.match(result.nextQuestion,/current speaker/i);
 }
 assert.equal((await boundSellerQualification(legacyRead,liveScope,timedCurrent,async()=>appendTimed('I own the property. I want to sell it.'))).ready,true,'proven later current ownership and interest can reconcile the identity correction');
}
legacyRows=[historyRow(100,'incoming',"I'm just the tenant.")];
for(const continuity of [{offerState:{acceptedPriceCents:6000000}},{pendingAgreement:{priceCents:6000000,closingDate:'2026-12-01'}}]){
 const protectedOffer=await automaticCallOffer('a'.repeat(64),{action:'get_offer',conversationId:liveScope.conversationId},{...d,
  db:async(path)=>{assert.equal(path,'rpc/icash_call_offer_context','identity correction must not save or advance an offer');return {party:'seller',address:'3614 FRANK ST',snapshot,...continuity};},
  verifyQualification:()=>boundSellerQualification(legacyRead,liveScope,timedCurrent,freshCurrent),
 });assert.equal(protectedOffer.quoteAllowed,false);assert.equal(protectedOffer.reason,'seller_qualification_required');
}
legacyCalls=[{completed_at:new Date(historyAt-1000).toISOString(),result:{transcript:qualifiedSellerTurns}}];
legacyRows=[historyRow(100,'incoming','I no longer own the property.')];
const returning={...timedCurrent,transcript:[{role:'user',message:'I am calling back.',time_in_call_secs:1}]};
const returningFresh={...returning,transcript:[...returning.transcript,{role:'user',message:'I own the property.',time_in_call_secs:110}]};
assert.equal((await boundSellerQualification(legacyRead,liveScope,returning,async()=>returningFresh)).ready,true,'a specific later ownership correction preserves independently completed earlier condition/occupancy/timing answers');
for(const completed_at of [undefined,'invalid',new Date(historyAt+120000).toISOString()]){
 legacyCalls=[{completed_at,result:{transcript:qualifiedSellerTurns}}];
 assert.equal((await boundSellerQualification(legacyRead,liveScope,returning,async()=>returningFresh)).stop,true,'unknown or overlapping completed-call timing cannot establish conflict order');
}
legacyCalls=[];legacyRows=[historyRow(100,'incoming','Here is the paint color.')];freshReads=0;
assert.equal((await boundSellerQualification(legacyRead,liveScope,timedCurrent,freshCurrent)).ready,true,'an ordinary incomplete informational text does not invalidate complete current qualification');assert.equal(freshReads,0);
console.log('PASS fresh-call price hold, rapport progression, refusals, unknown answers, repair-save hold, completed qualification, acceptance continuity, buyer isolation and reset history boundaries. No external calls.');
