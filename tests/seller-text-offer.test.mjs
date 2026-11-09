import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {processSellerTextOffer} from '../lib/seller-text-offer-service.ts';
import {planSellerTextOffer} from '../lib/seller-text-offer.ts';
import {calculateAutomaticCallOffer} from '../lib/automatic-call-offer.ts';
import {callSellerPriceEvidence} from '../lib/call-offer-evidence.ts';
globalThis.fetch=async()=>{throw Error('NO NETWORK: offline fixtures only');};
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const fixture=read('./helpers/seller-progress-fixture.sql'),split=fixture.indexOf('create function icash_queue_ai_reply(');
const fn=(file,name)=>{const s=read('../config/'+file+'.sql'),start=s.indexOf('create function public.'+name+'('),tag=s.slice(start).match(/\bas (\$[A-Za-z_]*\$)/i)[1],body=s.indexOf(tag,start);return s.slice(start,s.indexOf(tag+';',body+tag.length)+tag.length+1);};
const pg=await PGlite.create(),q=(s,a=[])=>pg.query(s,a),one=async(s,a=[])=>(await q(s,a)).rows[0];
const rpc=async(n,args=[])=>Object.values(await one(`select ${n}(${args.map((_,i)=>'$'+(i+1)).join(',')})`,args))[0];
await pg.exec(fixture.slice(0,split)+read('./fixtures/seller-progress-original-functions.sql')+fixture.slice(split)+read('./helpers/seller-dialogue-fixture.sql')+read('./fixtures/seller-dialogue-original-functions.sql')+
 fn('seller-response-policy','icash_seller_direct_response_match')+fn('seller-response-policy','icash_seller_response_disposition')+fn('seller-gap-recovery','icash_seller_contact_stop')+
 'create trigger icash_text_ai_incoming after insert on icash_text_messages for each row execute function icash_enqueue_text_ai();'+read('../config/seller-reply-progress.sql')+read('../config/seller-dialogue.sql')+
 read('./helpers/seller-text-offer-fixture.sql')+read('./fixtures/seller-text-offer-original-functions.sql')+read('../config/seller-text-offer.sql')+read('../config/seller-offer-receipt-wait.sql')+read('../config/seller-offer-source-prices.sql')+read('./helpers/seller-call-terminal-fixture.sql')+read('../config/seller-call-terminal-progress.sql'));
await pg.exec("update icash_seller_progress_settings set enabled=true,dialogue_enabled=true,offer_enabled=true,offer_enabled_at=now()-interval '2 hours'");
let tick=0,sends=0,texts=0,dispatches=0,providerFailure=false,deliver=true;
const at=()=>new Date(Date.now()-3600000+(++tick)*1000).toISOString();
const terms={seller:'',buyer:'Fixture Buyer',address:'45 Oak Road',legalDescription:'Lot 1, Fixture Subdivision',state:'TX',priceCents:21500000,priceSource:'proposed'};
const snapshot={propertyId:'prop_123',propertyType:'house',fetchedAt:new Date().toISOString(),sellerCostReserveCents:0,raw:{data:{dm_property_id:'prop_123',full_address:terms.address,estimated_value:200000,estimated_repair_cost:40000,total_estimated_loan_balance:20000,estimated_equity_percentage:90}}};
async function incoming(c,body,extra={}){return one("insert into icash_text_messages(account_id,thread_id,direction,state,body,event_id,created_at) values($1,$2,'incoming','received',$3,$4,$5) on conflict(event_id) do update set body=icash_text_messages.body returning *",[c.a,c.t,body,extra.event??randomUUID(),extra.at??at()]);}
async function seed({qualified=true}={}){
 const c={a:randomUUID(),t:randomUUID(),d:randomUUID(),s:randomUUID(),u:randomUUID(),phone:'+1214'+Math.floor(Math.random()*9999999).toString().padStart(7,'0')};
 await q('insert into auth.users(id,email) values($1,$2)',[c.u,'owner@example.invalid']);await q('insert into icash_accounts(id,owner_user_id) values($1,$2)',[c.a,c.u]);
 await q('insert into icash_customer_identities values($1,$2)',[c.a,terms.buyer]);
 await q('insert into icash_screening_jobs(id,account_id,snapshot,result) values($1,$2,$3,$4)',[c.s,c.a,snapshot,{financialCheck:{status:'eligible'}}]);
 await q('insert into icash_deal_files(id,account_id,screening_id,terms) values($1,$2,$3,$4)',[c.d,c.a,c.s,terms]);
 await q('insert into icash_text_threads(id,account_id,deal_id,recipient) values($1,$2,$3,$4)',[c.t,c.a,c.d,c.phone]);
 await q("insert into icash_sms_routes(sender,recipient,account_id) values('+15550000001',$1,$2)",[c.phone,c.a]);
 if(qualified)for(const [question,answer] of [['Are you the owner of this property?','Yes'],['Are you looking to sell?','Yes'],['What has you thinking about selling?','I am moving'],['What repairs does it need?','It needs paint'],['Is anyone living there?','It is vacant'],['When would you like to sell?','Next month'],['Is it listed with a real estate agent?','No']]){
  await q("insert into icash_text_messages(account_id,thread_id,direction,state,body,provider_id,created_at) values($1,$2,'outgoing','delivered',$3,'fixture-history',$4)",[c.a,c.t,question,at()]);await incoming(c,answer);
 }
 return c;
}
const db=async(path,method,body)=>{
 if(path==='rpc/icash_seller_prior_call_context')return [];
 if(path==='rpc/icash_finish_seller_agreement'){await q('update icash_seller_agreement_private.confirmations set envelope_id=$1,state=\'ready\' where id=$2',[body.p_envelope,body.p_id]);return true;}
 if(path==='rpc/icash_fail_seller_agreement'){await q("update icash_seller_agreement_private.confirmations set state='needs_review' where id=$1",[body.p_id]);return true;}
 assert(path.startsWith('rpc/'));return rpc(path.slice(4),Object.values(body));
};
const dependencies={db,dispatch:async(a,id)=>{
 assert(await rpc('icash_claim_text',[a,id,'+15550000001']),'full production final admission');
 assert.equal(await rpc('icash_claim_text',[a,id,'+15550000001']),null,'duplicate final claim');dispatches++;
 await q('update icash_text_messages set state=$1,provider_id=$2,created_at=$3 where id=$4',[deliver?'delivered':'accepted','receipt-'+id,at(),id]);return {status:deliver?'message_delivered':'message_accepted'};
},send:async input=>{
 sends++;if(providerFailure)throw Error('provider outcome unknown');
 const deal=await one('select terms from icash_deal_files where account_id=$1 and id=$2',[input.accountId,input.dealId]);
 const e=await one("insert into icash_signing_envelopes(account_id,deal_id,state,provider_id,terms,recipients) values($1,$2,'awaiting_counterparty','fixture-envelope',$3,$4) returning id",[input.accountId,input.dealId,deal.terms,[{...input.signers[0],id:'1'},{name:'Fixture Buyer',id:'2'}]]);return {id:e.id,testMode:false};
},text:async()=>{texts++;return {sent:true,status:'message_accepted'};}};
async function run(c,body,extra={}){
 const source=await incoming(c,body,extra),j=await one('select * from icash_text_ai_jobs where message_id=$1',[source.id]);
 const resume=await rpc('icash_resume_seller_text_ai',[c.a,j.id]);assert.equal(resume.mode,'seller_offer',JSON.stringify({body,resume}));
 const plan=planSellerTextOffer(resume.context);const result=await processSellerTextOffer(resume.context,dependencies);
 const progress=await rpc('icash_finish_seller_text_progress',[c.a,j.id,['message_delivered','message_accepted','text_ai_waiting','seller_agreement_sent'].includes(result.status)?null:result.status]);
 return {source,j,plan,result,progress,context:resume.context};
}
// Floral City class: a seller ask above the saved proposal/model is a counteroffer,
// not an invented acceptance of the customer's old $215k proposal.
const c=await seed();let r=await run(c,'$210,000 works for me');
assert.equal(r.plan.action,'cash_offer');assert.equal(r.plan.state.quotedPriceCents,10200000);assert.equal(r.plan.state.acceptedPriceCents,null);
assert.match(r.plan.body,/You asked \$210,000/);assert.equal(r.progress.reason,'awaiting_seller_reply');
r=await run(c,'Yes');assert.equal(r.plan.action,'legal_name');assert.equal(r.plan.state.acceptedPriceCents,10200000);
r=await run(c,'My full legal name is Jane Seller');assert.equal(r.plan.action,'owners');
r=await run(c,'Yes, I am the only owner and decision maker');assert.equal(r.plan.action,'closing_date');
const close=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
r=await run(c,close);assert.equal(r.plan.action,'inspection');
for(const body of ['February 30, '+(new Date().getUTCFullYear()+1),'Not '+close,close+' only if you pay more',close+' or '+close]){
 const context={...r.context,messages:r.context.messages.map(m=>m.id===r.source.id?{...m,body}:m)};
 const invalid=planSellerTextOffer(context);assert.equal(invalid.state.closing.date,undefined,'never adopt '+body);
 assert.equal(invalid.action,body.includes('only if')?'cash_offer':'closing_date','clarify '+body);
}
const namedClose=new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'long',day:'numeric',year:'numeric'}).format(new Date(close+'T12:00:00Z'));
assert.equal(planSellerTextOffer({...r.context,messages:r.context.messages.map(m=>m.id===r.source.id?{...m,body:'We can close on '+namedClose}:m)}).state.closing.date,close);
r=await run(c,'Yes');assert.equal(r.plan.action,'confirm_terms');assert(r.plan.body.length<=160);
r=await run(c,'Yes, send the agreement');assert.equal(r.plan.kind,'agreement');assert.equal(r.result.status,'seller_agreement_sent');assert.equal(sends,1);assert.equal(texts,1);assert.equal(r.progress.state,'waiting');
assert.equal((await one('select terms from icash_deal_files where id=$1',[c.d])).terms.priceCents,10200000);
assert.equal(await rpc('icash_claim_seller_text_agreement',[c.a,r.j.id]),null,'one-use signing claim');
assert.equal((await one('select count(*)::int n from icash_seller_agreement_private.confirmations where account_id=$1',[c.a])).n,1);

const ownerUnknown=await seed({qualified:false});r=await run(ownerUnknown,'How much');assert.equal(r.plan.action,'qualify_ownership');assert.equal(r.plan.state.acceptedPriceCents,null);
// A rejected delivered price must move negotiation forward through the real
// SQL save/claim/receipt loop, without turning the next counterprice into payoff.
const rejected=await seed();await run(rejected,'I need $210k');
r=await run(rejected,'No');assert.equal(r.plan.action,'seller_counterprice');
assert.equal(r.result.status,'message_delivered');assert.equal(r.progress.reason,'awaiting_seller_reply');
r=await run(rejected,'90,000');assert.equal(r.plan.action,'cash_offer');
assert.equal(r.plan.state.quotedPriceCents,9000000);assert.equal(r.plan.state.acceptedPriceCents,null);
r=await run(rejected,'Yes');assert.equal(r.plan.action,'legal_name');assert.equal(r.plan.state.acceptedPriceCents,9000000);
// A new price question reopens negotiation even after an earlier yes. It is
// neither a legal-name answer nor acceptance of the current or requested price.
for(const [body,asking,quoted] of [
 ['Could you do $120,000?',12000000,10200000],
 ['Can you pay me $90,000?',9000000,9000000],
 ['Would you offer one hundred twenty thousand dollars?',12000000,10200000],
 ['Will you do $102,000?',10200000,10200000],
]){
 const counter=await seed();await run(counter,'I need $210k');
 r=await run(counter,'Yes');assert.equal(r.plan.action,'legal_name');
 r=await run(counter,body);assert.equal(r.plan.action,'cash_offer',body);
 assert.equal(r.plan.state.acceptedPriceCents,null,body+' is not acceptance');
 assert.equal(r.plan.state.proposedPriceCents,asking);assert.equal(r.plan.state.quotedPriceCents,quoted);
 assert.equal(r.progress.reason,'awaiting_seller_reply');
 r=await run(counter,'Yes');assert.equal(r.plan.action,'legal_name');
 assert.equal(r.plan.state.acceptedPriceCents,quoted,'a fresh answer to the delivered proposal is required');
}
for(const body of ['Could you do $120k net?','Could you do $120k if we close Friday?','Could you do $120k or $130k?','Could you not do $120k?','Could you offer a $120k repair budget?','Can you pay my $120k mortgage?','Could you do a $120k deposit?']){
 assert.equal(callSellerPriceEvidence({transcript:[{role:'user',message:body}]},{action:'report_change',sellerStatement:body}),null,body);
}
assert.equal(callSellerPriceEvidence({transcript:[{role:'user',message:'Could you do $120k net?'}]},{action:'report_change',sellerStatement:'Could you do $120k?'}),null,'the whole latest source must match');
for(const body of ['90,000','I am asking ninety thousand dollars.']){
 const ordinaryPrice=await seed();
 await q("insert into icash_text_messages(account_id,thread_id,direction,state,body,provider_id,created_at) values($1,$2,'outgoing','delivered','What price did you have in mind?','fixture-price-question',$3)",[ordinaryPrice.a,ordinaryPrice.t,at()]);
 r=await run(ordinaryPrice,body);assert.equal(r.plan.action,'cash_offer');assert.equal(r.plan.state.quotedPriceCents,9000000);assert.equal(r.plan.state.acceptedPriceCents,null,'an asking-price answer is not acceptance');
}
const receipt=await seed();deliver=false;r=await run(receipt,'I need $210k');deliver=true;
const before=dispatches;r=await run(receipt,'Yes');assert.equal(r.plan.kind,'wait');assert.equal(dispatches,before);
assert.equal(r.progress.state,'waiting');assert.equal(r.progress.reason,'offer_receipt_pending');
assert.match((await one('select wait_trigger from icash_seller_reply_progress where message_id=$1',[r.source.id])).wait_trigger,/original call\/message completion receipt/);
assert.equal((await rpc('icash_refresh_seller_reply_progress',[receipt.a,r.source.id,null])).state,'waiting','maintenance preserves the explicit wait');
await q("update icash_text_messages set state='delivered' where account_id=$1 and state='accepted'",[receipt.a]);
const resumed=await rpc('icash_resume_seller_text_ai',[receipt.a,r.j.id]);assert.equal(resumed.mode,'seller_offer');assert.equal(planSellerTextOffer(resumed.context).action,'legal_name');
assert.equal((await processSellerTextOffer(resumed.context,dependencies)).status,'message_delivered');
assert.equal((await rpc('icash_finish_seller_text_progress',[receipt.a,r.j.id,null])).reason,'awaiting_seller_reply');assert.equal(dispatches,before+1,'receipt wakes the same source exactly once');
// Reproduce the production terminal-gate false active-call hold, then require
// the exact settled carrier receipt before negotiation can advance.
const terminal=await seed(),rid=randomUUID(),operation='voice:'+randomUUID();
const terminalReceipt={providerAccountSid:'ACfixture',callSid:'CAfixture',fromPhone:'+15550000001',toPhone:terminal.phone,status:'no-answer'};
await q("insert into icash_call_recordings(id,account_id,screening_id,party,dial_claimed_at,state,last_action,operation_key,provider_account_sid,call_sid,from_phone,to_phone) values($1,$2,$3,'seller',now()-interval '30 minutes','failed','gate_settled',$4,'ACfixture','CAfixture','+15550000001',$5)",[rid,terminal.a,terminal.s,operation,terminal.phone]);
await q("insert into icash_operation_spend values($1,$2,'settled')",[operation,terminal.a]);
const terminalSource=await incoming(terminal,'I need $210k');
const ctx=()=>rpc('icash_seller_text_offer_context',[terminal.a,terminalSource.id]);
assert.ok((await ctx()).activeCallSince,'State/last-action labels without the original receipt are insufficient');
for(const receipt of [{...terminalReceipt,callSid:'CAforeign'},{...terminalReceipt,status:'in-progress'}]){
 await q('insert into icash_recording_private.terminal_cost_receipts values($1,$2) on conflict(recording_id) do update set receipt=excluded.receipt',[rid,receipt]);
 assert.ok((await ctx()).activeCallSince,'Mismatched/nonterminal receipts keep the hold');
}
await q('update icash_recording_private.terminal_cost_receipts set receipt=$2 where recording_id=$1',[rid,terminalReceipt]);
assert.equal((await ctx()).activeCallSince,null,'The exact settled terminal receipt clears only the conversational wait');
assert.equal(planSellerTextOffer(await ctx()).kind,'message');
await q("update icash_operation_spend set state='reserved' where operation_key=$1",[operation]);assert.ok((await ctx()).activeCallSince,'Unknown money remains held');
await q("update icash_operation_spend set state='settled' where operation_key=$1",[operation]);
await q("update icash_call_recordings set conversation_id='conv_unresolved' where id=$1",[rid]);assert.ok((await ctx()).activeCallSince,'Contradictory started AI keeps the hold');
await q('update icash_call_recordings set conversation_id=null where id=$1',[rid]);
assert.equal(await rpc('icash_seller_recorded_call_finished',[randomUUID(),rid]),false,'Cross-account receipt lookup is isolated');
assert.equal((await one('select call_ended_at from icash_call_recordings where id=$1',[rid])).call_ended_at,null,'No invented termination timestamp');
const active=await seed();await q("insert into icash_call_recordings(account_id,screening_id,party,dial_claimed_at,call_ended_at) values($1,$2,'seller',now(),null)",[active.a,active.s]);
r=await run(active,'I need $210k');assert.equal(r.progress.state,'waiting');assert.equal(r.progress.reason,'seller_call_active');
await q('update icash_accounts set bot_paused=true where id=$1',[active.a]);
assert.equal((await rpc('icash_finish_seller_text_progress',[active.a,r.j.id,null])).state,'needs_review','Pause overrides a stored wait');

const changes=await seed();r=await run(changes,'I am asking $210k');
const source=await incoming(changes,'Yes'),job=await one('select * from icash_text_ai_jobs where message_id=$1',[source.id]);
const old=(await rpc('icash_resume_seller_text_ai',[changes.a,job.id])).context;
await q("update icash_accounts set bot_paused=true where id=$1",[changes.a]);
assert.equal(await rpc('icash_save_seller_text_offer',[changes.a,job.id,old.fingerprint,old.offerVersion,planSellerTextOffer(old)]),null,'concurrent Pause invalidates plan');
await q("update icash_accounts set bot_paused=false where id=$1",[changes.a]);
await q("update icash_deal_files set terms=terms||'{\"priceCents\":9900000}' where id=$1",[changes.d]);
assert.equal(await rpc('icash_save_seller_text_offer',[changes.a,job.id,old.fingerprint,old.offerVersion,planSellerTextOffer(old)]),null,'human terms are not overwritten');
await q("update icash_text_threads set permission_until=now()-interval '1 second' where id=$1",[changes.t]);
assert.equal(await rpc('icash_seller_text_offer_context',[changes.a,source.id]),null,'expired checks stay held');
assert.equal(await rpc('icash_seller_text_offer_context',[c.a,source.id]),null,'account isolation');

for(const body of ['I need $210k','I want $210,000','$210,000 works for me'])assert.equal(callSellerPriceEvidence({transcript:[{role:'user',message:body}]},{action:'report_change',sellerStatement:body}),21000000);
for(const body of ['I need $210k net','I need $210k if you close Friday','I owe $210k','Not $210k'])assert.equal(callSellerPriceEvidence({transcript:[{role:'user',message:body}]},{action:'report_change',sellerStatement:body}),null);
for(const question of ['How much is the repair budget?','What is your mortgage payoff balance?'])assert.equal(callSellerPriceEvidence({transcript:[{role:'agent',message:question},{role:'user',message:'I need $40k'}]},{action:'report_change',sellerStatement:'I need $40k'}),null,'do not convert another dollar answer into seller ask');
const base={party:'seller',address:terms.address,snapshot};assert.equal(calculateAutomaticCallOffer(base,{proposedPriceCents:21000000}).priceCents,10200000);
assert.equal(calculateAutomaticCallOffer(base,{proposedPriceCents:9000000}).priceCents,9000000);
assert.equal(calculateAutomaticCallOffer(base,{acceptedPriceCents:9000000,proposedPriceCents:21000000}).priceCents,9000000,'accepted price is not silently increased');
assert.equal(calculateAutomaticCallOffer({...base,pendingAgreement:{priceCents:9500000,closingDate:close}},{proposedPriceCents:21000000}).priceCents,9500000,'prepared agreement stays frozen');
assert.equal(calculateAutomaticCallOffer({...base,snapshot:{...snapshot,fetchedAt:new Date(Date.now()-25*3600000).toISOString()}},{proposedPriceCents:21000000}).quoteAllowed,false);

const net=await seed();r=await run(net,'I need $210k net');assert.equal(r.plan.action,'clarify_gross_price');assert.equal(r.plan.state.acceptedPriceCents,null);
r=await run(net,'Yes');assert.equal(r.plan.action,'cash_offer');assert.equal(r.plan.state.proposedPriceCents,21000000);
const duplicate=await seed(),event=randomUUID();r=await run(duplicate,'I need $210k',{event});
const same=await incoming(duplicate,'I need $210k',{event});assert.equal(same.id,r.source.id);
assert.equal((await one('select count(*)::int n from icash_text_ai_jobs where message_id=$1',[same.id])).n,1);
assert.equal((await rpc('icash_resume_seller_text_ai',[duplicate.a,r.j.id])).mode,'held','delivered source is not replayed');

const unknown=await seed();await run(unknown,'I need $210k');await run(unknown,'Yes');await run(unknown,'Jane Seller');await run(unknown,'Yes, I am the only owner and decision maker');await run(unknown,close);await run(unknown,'Yes');
providerFailure=true;const sendsBefore=sends;r=await run(unknown,'Yes, send the agreement');providerFailure=false;
assert.equal(r.result.status,'seller_agreement_receipt_unresolved');assert.equal(r.progress.reason,'agreement_receipt_unresolved');
assert.equal(await rpc('icash_claim_seller_text_agreement',[unknown.a,r.j.id]),null);assert.equal(sends,sendsBefore+1,'unknown provider outcome is never replayed');

const pending=await seed();deliver=false;r=await run(pending,'I need $210k');deliver=true;
await q("update icash_text_messages set updated_at=now()-interval '16 minutes' where account_id=$1 and direction='outgoing' and state='accepted'",[pending.a]);
r=await run(pending,'Yes');assert.equal(r.plan.kind,'review');assert.equal(r.progress.reason,'offer_receipt_unresolved');
const failure=await seed();r=await run(failure,'I need $210k');await q("update icash_text_messages set state='failed' where account_id=$1 and request_key=$2",[failure.a,r.j.id]);
r=await run(failure,'Yes');assert.equal(r.plan.kind,'review');assert.equal(r.plan.state.acceptedPriceCents,null,'a failed price message cannot be accepted');

const finalGate=await seed();const gateSource=await incoming(finalGate,'I need $210k'),gateJob=await one('select * from icash_text_ai_jobs where message_id=$1',[gateSource.id]);
const gateContext=(await rpc('icash_resume_seller_text_ai',[finalGate.a,gateJob.id])).context,gatePlan=planSellerTextOffer(gateContext);
const gateSaved=await rpc('icash_save_seller_text_offer',[finalGate.a,gateJob.id,gateContext.fingerprint,gateContext.offerVersion,gatePlan]);
await q("update icash_screening_jobs set snapshot=jsonb_set(snapshot,'{raw,data,estimated_value}','150000') where id=$1",[finalGate.s]);
assert.equal(await rpc('icash_claim_text',[finalGate.a,gateSaved.messageId,'+15550000001']),null,'changed underwriting invalidates a queued proposal at final dispatch');
const historical=await seed();const oldReply=await incoming(historical,'$210,000 works for me',{at:new Date(Date.now()-10*86400000).toISOString()});assert.equal(await rpc('icash_seller_text_offer_context',[historical.a,oldReply.id]),null,'historical negotiations are not replayed');
for(const role of ['anon','authenticated'])for(const f of ['icash_seller_text_offer_context(uuid,uuid)','icash_save_seller_text_offer(uuid,uuid,text,bigint,jsonb)','icash_claim_seller_text_agreement(uuid,uuid)'])assert.equal((await one('select has_function_privilege($1,$2,\'execute\') ok',[role,'public.'+f])).ok,false);

// Disposition uses the same source/dispatch loop, preserving the published buyer
// price. A counteroffer gets an answer, and a later repeat is not a stranded draft.
await pg.exec(`drop function icash_buyer_factual_text(uuid,uuid,text);
 create function icash_buyer_reply_before_price_privacy(a uuid,t uuid,b text) returns text language sql as $$select case when b='What is the buyer price?' then 'The buyer price is $112,000, including our fee, plus buyer closing costs.' end$$;
 drop function icash_buyer_package_data(uuid,uuid);
 create function icash_buyer_package_data(p_account uuid,p_deal uuid) returns jsonb language sql stable set search_path=public as $$select case when exists(select 1 from icash_deal_files where id=p_deal and account_id=p_account) then '{"askingPriceCents":11200000,"reserved":false,"titleSelectionStatus":"not_selected"}'::jsonb end$$;`+
 read('./fixtures/buyer-reply-original-functions.sql')+read('../config/buyer-reply-progress.sql'));
await pg.exec("update icash_seller_progress_settings set buyer_reply_enabled=true,buyer_reply_enabled_at=now()-interval '2 hours'");
const buyer=await seed({qualified:false});await q("update icash_text_threads set party='buyer' where id=$1",[buyer.t]);
for(const body of ['I offer $90,000','What is the buyer price?','What is the buyer price?']){
 const m=await incoming(buyer,body),j=await one('select * from icash_text_ai_jobs where message_id=$1',[m.id]);
 const resumed=await rpc('icash_resume_seller_text_ai',[buyer.a,j.id]);assert.equal(resumed.mode,'dispatch',body);
 const saved=await one('select body from icash_text_messages where id=$1',[resumed.messageId]);assert.match(saved.body,/112,000/);assert(!saved.body.includes('102,000'));assert(saved.body.length<=160);
 await dependencies.dispatch(buyer.a,resumed.messageId);assert.equal((await rpc('icash_finish_seller_text_progress',[buyer.a,j.id,null])).state,'waiting');
}
const odd=await incoming(buyer,'There is an easement problem to resolve');const oddJob=await one('select * from icash_text_ai_jobs where message_id=$1',[odd.id]);
await q("update icash_text_ai_jobs set state='drafted',analysis='{\"action\":\"review\"}' where id=$1",[oddJob.id]);
assert.equal((await rpc('icash_finish_seller_text_progress',[buyer.a,oddJob.id,'action_not_admitted'])).reason,'buyer_next_action_required');
assert.equal((await one("select count(*)::int n from icash_text_attention where account_id=$1 and state='open'",[buyer.a])).n,1,'unanswered buyer is visible');

// Exercise the actual maintenance entry point with both flags enabled. The
// original buyer migration reused its enclosing job variable as a table alias,
// which failed even with no due buyers. Direct resume tests missed that branch.
await pg.exec("update icash_text_ai_jobs set next_attempt_at=now()+interval '1 day';update icash_seller_reply_progress set next_check_at=now()+interval '1 day'");
await assert.rejects(rpc('icash_issue_due_text_ai'),e=>e.code==='42702' && /ambiguous/.test(e.message));
await pg.exec(read('../config/buyer-receipt-dispatch.sql'));
assert.equal(await rpc('icash_issue_due_text_ai'),null,'enabled empty buyer maintenance reaches the existing dispatcher');
const receiptBuyer=await seed({qualified:false});await q("update icash_text_threads set party='buyer' where id=$1",[receiptBuyer.t]);
const bm=await incoming(receiptBuyer,'I offer $90,000'),bj=await one('select * from icash_text_ai_jobs where message_id=$1',[bm.id]);
const br=await rpc('icash_resume_seller_text_ai',[receiptBuyer.a,bj.id]);
deliver=false;await dependencies.dispatch(receiptBuyer.a,br.messageId);deliver=true;
assert.equal((await rpc('icash_finish_seller_text_progress',[receiptBuyer.a,bj.id,null])).reason,'provider_delivery_pending');
const receiptCount=(await one('select count(*)::int n from icash_text_messages where account_id=$1',[receiptBuyer.a])).n;
const dueBuyer=()=>q("update icash_buyer_reply_progress set updated_at=now()-interval '2 minutes' where message_id=$1",[bm.id]);
await dueBuyer();await rpc('icash_issue_due_text_ai');
assert.equal((await one('select reason from icash_buyer_reply_progress where message_id=$1',[bm.id])).reason,'provider_delivery_pending');
await q("update icash_text_messages set state='delivered' where id=$1",[br.messageId]);
await dueBuyer();await rpc('icash_issue_due_text_ai');
assert.equal((await one('select reason from icash_buyer_reply_progress where message_id=$1',[bm.id])).reason,'awaiting_buyer_reply','scheduler reconciles the original late receipt');
assert.equal((await one('select count(*)::int n from icash_text_messages where account_id=$1',[receiptBuyer.a])).n,receiptCount,'receipt maintenance never resends');
assert.equal((await one("select has_function_privilege('anon','public.icash_issue_due_text_ai()','execute') ok")).ok,false);
assert.equal((await one("select has_function_privilege('service_role','public.icash_issue_due_text_ai()','execute') ok")).ok,true);
await pg.close();console.log('PASS supported SMS counteroffer -> acceptance -> identity/date/terms -> one agreement, actual dispatch, receipt wait, changed terms/Pause/expiry/account boundaries; zero provider calls.');
