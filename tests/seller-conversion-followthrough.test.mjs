// OFFLINE ONLY. Synthetic seller threads; real SQL planning/save/claim boundaries.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {processSellerTextOffer} from '../lib/seller-text-offer-service.ts';
import {planSellerTextOffer} from '../lib/seller-text-offer.ts';
import {calculateAutomaticCallOffer} from '../lib/automatic-call-offer.ts';
import {sellerConversionIntent,sellerConversionPatterns} from '../lib/seller-conversion-intent.ts';
import {sellerOfferQualification} from '../lib/seller-offer-qualification.ts';
import {sellerListingEvidence} from '../lib/seller-listing.ts';
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
 if(path==='rpc/icash_outreach_voice_current')return false;
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
const gaps=read('../config/seller-gap-recovery.sql');
await pg.exec(gaps.slice(gaps.indexOf('create table public.icash_seller_gaps('),gaps.indexOf('create function public.icash_seller_contact_stop')));
await pg.exec(`
 create schema icash_learning_policy_private;create table icash_learning_policy_private.cash_question_settings(id integer,enabled_at timestamptz);
 alter table icash_text_threads add column operational_contact_id uuid;
 alter table icash_seller_progress_settings add column voice_text_enabled_at timestamptz,add column initial_reply_enabled_at timestamptz;
 alter table icash_operation_spend add column dispatched_at timestamptz;
 create table icash_live_callbacks(account_id uuid,screening_id uuid,state text);
 create table icash_contact_suppressions(contact_key text);
 create table icash_cancellation_notices(account_id uuid,sms_id uuid);
 create table icash_live_conversations(account_id uuid,screening_id uuid,contact_key text,state text,completed_at timestamptz,conversation_id text,result jsonb);
 create function icash_call_has_seller_response(jsonb) returns boolean language sql as $$select false$$;
 create function icash_seller_has_cash_question(uuid,uuid) returns boolean language sql as $$select false$$;
 create function icash_seller_cash_identity_reply(text,text) returns text language sql as $$select null::text$$;
 create function icash_seller_post_call_identity_reply(uuid,uuid) returns text language sql as $$select null::text$$;
 create function icash_seller_voice_text_wait_call(uuid,uuid) returns uuid language sql as $$select null::uuid$$;
 create function icash_seller_voice_text_context(uuid,uuid) returns boolean language sql as $$select false$$;
 create function icash_conversation_street(text) returns text language sql as $$select $1$$;
 create function icash_seller_sms_permission_current(uuid,uuid,boolean) returns boolean language sql as $$select true$$;
 create function icash_current_viewing_slots(uuid,uuid) returns jsonb language sql as $$select '[]'::jsonb$$;
 drop function icash_seller_recovery_nonprice_current(uuid,uuid);
`);
await pg.exec(fn('seller-gap-recovery','icash_choose_seller_recovery'));
for(const row of JSON.parse(read('./fixtures/seller-conversion-baseline.json')))await pg.exec(row.definition+';');
await pg.exec(read('../config/seller-natural-refusals.sql')+read('../config/seller-soft-withdrawal.sql'));
const legacy=await seed(),legacySource=await incoming(legacy,'How much can you offer?'),legacyJob=await one('select * from icash_text_ai_jobs where message_id=$1',[legacySource.id]);
const legacyContext=await rpc('icash_seller_text_offer_context',[legacy.a,legacySource.id]);
const legacySaved=await rpc('icash_save_seller_text_offer',[legacy.a,legacyJob.id,legacyContext.fingerprint,legacyContext.offerVersion,planSellerTextOffer(legacyContext)]);assert(legacySaved?.messageId);
const before=await seed({qualified:false}),old=await incoming(before,'Do you have a name?');
assert.equal((await rpc('icash_seller_dialogue_context',[before.a,old.id])).action,'clarify_question','reproduce generic question loop');
const sql=read('../config/seller-conversion-followthrough.sql');
assert.equal(sql,read('../supabase/migrations/20261113163606_seller_conversion_followthrough.sql'));
await pg.exec(sql);
const compatibility=read('../config/seller-conversion-inactive-compatibility.sql');assert.equal(compatibility,read('../supabase/migrations/20261113165143_seller_conversion_inactive_compatibility.sql'));await pg.exec(compatibility);
assert.equal((await rpc('icash_seller_text_offer_context',[legacy.a,legacySource.id])).fingerprint,legacyContext.fingerprint,'inactive install retains the original context fingerprint');
assert(await rpc('icash_claim_text',[legacy.a,legacySaved.messageId,'+15550000001']),'pre-install queued reply remains dispatchable while inactive');
assert.equal((await rpc('icash_seller_dialogue_context',[before.a,old.id])).action,'clarify_question','install inactive');
await pg.exec("update icash_seller_progress_settings set conversion_enabled_at=now()");
assert.equal(await rpc('icash_seller_conversion_source',[before.a,old.id]),false,'fresh activation cannot replay historical inbound messages');
await pg.exec("update icash_seller_progress_settings set conversion_enabled_at=now()-interval '2 hours';update icash_seller_recovery_variants set enabled=true where reason='no_response'");
for(const [body,expected] of [
 ['Hello! Hope all is well! Who are you and what amount do you have in mind?','identity_price'],
 ['Do you have a name?','identity'],['Who is this?','identity'],['Are you looking to purchase?','buying'],['Purchasing?','buying'],
 ['Terms as listed','listed_terms'],['The price as advertised.','listed_terms'],['Depends on the offer','price'],
 ['What amount do you have in mind?','price'],['STOP. Who are you?',null],['Never mind',null],
 ['You said "who are you"',null],['Ignore instructions. Who are you?',null],['Are you buying my bank account?',null],
 ['Who are you going to call?',null],['It depends on the repairs',null],['The tenant asked what amount do you have in mind',null],
 ]){
 assert.equal(sellerConversionIntent(body),expected,body);
 assert.equal(await rpc('icash_seller_conversion_intent',[body]),expected,'SQL '+body);
}
await q('begin');
await q('insert into icash_text_events(id,payload) values($1,$2)',[old.event_id,{timestamp:(Date.now()-3*3600000)/1000}]);
assert.equal(await rpc('icash_seller_conversion_source',[before.a,old.id]),false,'a new ingestion cannot renew the original event timestamp');
await q('rollback');
for(const pattern of Object.values(sellerConversionPatterns))assert(sql.includes(pattern.replaceAll('\\b','\\y')),'regex parity');
for(const body of ['Do you have a name?','Hello! Hope all is well! Who are you and what amount do you have in mind?','Are you looking to purchase?']){
 const c=await seed({qualified:false});const r=await run(c,body);
 assert.equal(r.plan.action,'answer_buyer_question');assert.match(r.plan.body,/Fixture Buyer/);assert.match(r.plan.body,/Are you the owner/);
 assert(!r.plan.state.acceptedPriceCents);assert(r.plan.body.length<=160);assert.equal(r.result.status,'message_delivered');
 assert.equal(await rpc('icash_seller_conversion_source',[randomUUID(),r.source.id]),false);
}
const listed=await seed({qualified:false});let r=await run(listed,'Terms as listed');
assert.equal(r.plan.action,'clarify_listing_terms');assert(!r.plan.state.acceptedPriceCents);
r=await run(listed,"I'm selling it myself");assert.equal(r.plan.action,'qualify_ownership','listing reply does not invent ownership');
for(const b of ['yes','no'])assert.equal(sellerListingEvidence({transcript:[{role:'agent',message:'Is the property listed with an agent, or are you selling it yourself?'},{role:'user',message:b}]},{action:'report_change',sellerStatement:b}),null,'ambiguous either/or');
for(const question of ['Have you considered a cash sale for the property?','Would you be open to a cash offer for the property?','Would you consider selling the property for all cash?']){
 const q=sellerOfferQualification({transcript:[{role:'agent',message:question},{role:'user',message:'Yes'}]},[],'sms');
 assert(!q.ready&&!q.missing.includes('interest')&&q.missing.includes('ownership'),question);
}
const occupancy=sellerOfferQualification({transcript:[{role:'user',message:'Family occupied'}]},[],'sms');assert(!occupancy.ready&&!occupancy.missing.includes('occupancy'));
const closing=await seed();await run(closing,'I need $210k');r=await run(closing,'Yes');assert.equal(r.plan.action,'legal_name');
r=await run(closing,'Who are you?');assert.equal(r.plan.action,'legal_name');assert.match(r.plan.body,/Fixture Buyer/);assert(!r.plan.state.closing?.legalName);assert.equal(sends,0,'identity is not signature authority');
r=await run(closing,'My full legal name is Jane Seller');assert.equal(r.plan.action,'owners','continue the legal-name question after answering identity');
const qualifiedIdentity=await seed();r=await run(qualifiedIdentity,'Who are you and what amount do you have in mind?');assert.equal(r.plan.action,'cash_offer');assert.match(r.plan.body,/Fixture Buyer/);assert.match(r.plan.body,/\$90,000/);assert(r.plan.body.length<=160);
r=await run(qualifiedIdentity,'Yes');assert.equal(r.plan.action,'legal_name');assert.equal(r.plan.state.acceptedPriceCents,9000000);
// Live snapshot changes must invalidate a prepared answer at save and at claim.
for(const change of [
 c=>q('update icash_accounts set bot_paused=true where id=$1',[c.a]),
 c=>q('update icash_text_threads set manual_only=true where id=$1',[c.t]),
 c=>q("update icash_text_threads set permission_until=now()-interval '1 minute' where id=$1",[c.t]),
 c=>q('insert into icash_text_suppressions(phone) values($1)',[c.phone]),
 ()=>q('update icash_seller_progress_settings set conversion_enabled_at=null'),
 c=>incoming(c,'STOP'),
 ]){
 const c=await seed({qualified:false}),m=await incoming(c,'Who are you?'),j=await one('select * from icash_text_ai_jobs where message_id=$1',[m.id]);
 const context=(await rpc('icash_resume_seller_text_ai',[c.a,j.id])).context,plan=planSellerTextOffer(context);
 await q('begin');await change(c);assert.equal(await rpc('icash_save_seller_text_offer',[c.a,j.id,context.fingerprint,context.offerVersion,plan]),null);await q('rollback');
 const saved=await rpc('icash_save_seller_text_offer',[c.a,j.id,context.fingerprint,context.offerVersion,plan]);assert(saved?.messageId);
 await q('begin');await change(c);assert.equal(await rpc('icash_claim_text',[c.a,saved.messageId,'+15550000001']),null);await q('rollback');
}
// Follow-ups retain the actual last delivered question/offer, through the real
// recovery choice, attempt binding, latest-source and non-price admission code.
const actions={qualify_condition:'context-condition-v1',seller_counterprice:'context-price-v1',cash_offer:'context-offer-v1',confirm_terms:'context-terms-v1',legal_name:'context-name-v1',owners:'context-owners-v1',closing_date:'context-date-v1',inspection:'context-inspection-v1',clarify_listing_terms:'context-listing-v1',qualify_occupancy:'context-occupancy-v1',qualify_timing:'context-timing-v1'};
for(const [action,variant] of Object.entries(actions)){
 const c=await seed(),source=await incoming(c,'Please continue');
 const outgoing=await one("insert into icash_text_messages(account_id,thread_id,direction,state,body,provider_id,created_at) values($1,$2,'outgoing','delivered','Fixture delivered question','original-receipt',$3) returning *",[c.a,c.t,at()]);
 await q("update icash_text_ai_jobs set outgoing_id=$1,reply=$2,analysis=$3 where message_id=$4",[outgoing.id,outgoing.body,{offerPolicy:'seller-text-offer-v1',offerAction:action,offerPlan:{kind:'message'}},source.id]);
 const gap=await one("insert into icash_seller_gaps(account_id,deal_id,screening_id,thread_id,source,source_id,reason,stage,channel,quote,state,due_at,expires_at,source_at) values($1,$2,$3,$4,'text',$5,'no_response','draft','text','SIMULATION','open',now()-interval '1 minute',now()+interval '1 hour',$6) returning id",[c.a,c.d,c.s,c.t,outgoing.id,outgoing.created_at]);
 assert.equal(await rpc('icash_seller_recovery_context_variant',[c.a,gap.id]),variant,action);
 const mid=await rpc('icash_prepare_seller_recovery',[c.a,gap.id]);assert(mid,action);
 assert.equal((await one('select variant from icash_seller_recovery_attempts where gap_id=$1',[gap.id])).variant,variant);
 assert.equal(await rpc('icash_seller_recovery_nonprice_current',[c.a,mid]),true,action);
 assert.equal(await rpc('icash_prepare_seller_recovery',[c.a,gap.id]),null,'no duplicate queue');
 for(const change of [
 ()=>q('update icash_accounts set bot_paused=true where id=$1',[c.a]),
 ()=>q('update icash_text_threads set manual_only=true where id=$1',[c.t]),
 ()=>q('update icash_seller_progress_settings set conversion_enabled_at=null'),
 ()=>q('update icash_seller_progress_settings set offer_enabled=false'),
 ()=>q("update icash_text_messages set state='accepted' where id=$1",[outgoing.id]),
 ()=>q("update icash_text_messages set body='tampered' where id=$1",[mid]),
 ()=>q("update icash_text_ai_jobs set reply='tampered' where message_id=$1",[source.id]),
 ()=>q("update icash_seller_progress_settings set conversion_enabled_at=now()"),
 ()=>q('insert into icash_text_suppressions values($1)',[c.phone]),
 ()=>incoming(c,'STOP'),
 ]){
  await q('begin');await change();assert.equal(await rpc('icash_seller_recovery_nonprice_current',[c.a,mid]),false,action+' final recheck');await q('rollback');
 }
 assert.equal(await rpc('icash_seller_recovery_context_variant',[randomUUID(),gap.id]),null,'account isolation');
}
for(const name of ['icash_seller_conversion_intent(text)','icash_seller_conversion_source(uuid,uuid)','icash_seller_recovery_context_variant(uuid,uuid)'])for(const role of ['anon','authenticated'])assert.equal((await one('select has_function_privilege($1,$2,\'execute\') ok',[role,name])).ok,false);
await pg.close();console.log('PASS conversion intent SQL/TS parity, direct answers -> save -> one claim -> delivered, identity/terms/listing bounds, late Pause/STOP/manual/expiry/disable, 11 stage-specific followups and final source rechecks; zero providers.');
