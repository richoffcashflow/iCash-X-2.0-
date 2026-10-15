// Actual PostgreSQL migration and workers; all contacts/providers are local fixtures.
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {databaseAdapter,loadService} from './helpers/simulated-journey-services.mjs';
import {cancellationCallPrompt,cancellationNoticeLabel} from '../lib/cancellation-notice-policy.ts';
const pg=await PGlite.create(),{db,rpc,q}=databaseAdapter(pg);
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const actor=randomUUID(),account=randomUUID(),other=randomUUID(),emailRate=randomUUID(),voiceRate=randomUUID();
try{
 await pg.exec(read('tests/fixtures/cancellation-notice-db.sql'));
 await pg.exec(read('supabase/migrations/20261010045243_agreement_cancellation.sql'));
 await pg.exec(read('tests/fixtures/cancellation-manual-consent.sql'));
 await pg.exec(read('supabase/migrations/20261015225502_agreement_cancellation_notifications.sql'));
 await q('insert into auth.users values($1),($2)',[actor,other]);await q('insert into icash_accounts(id,owner_user_id) values($1,$2)',[account,actor]);
 await q('insert into icash_customer_identities values($1,$2)',[account,'Sample Investor LLC']);
 await q("insert into icash_operation_rates(id,operation,enabled,verified_at,expires_at,charge_cents,voice_max_duration_seconds,version,costs_micros) values($1,'manual_email',true,now()-interval '1 day',now()+interval '1 year',1,null,'fixture','{}'),($2,'seller_call',true,now()-interval '1 day',now()+interval '1 year',977,600,'required-audio-30d-speech-v1:fixture','{\"elevenlabs\":10000,\"twilio\":1000}')",[emailRate,voiceRate]);
 await q("insert into icash_voice_configs values($1,true,now()+interval '1 year',$2)",[account,voiceRate]);
 const timezone=(await q("select name from pg_timezone_names where extract(hour from now() at time zone name)=12 limit 1")).rows[0].name;
 let contactSequence=1000;
 const fixture=async({buyer=false,test=false,unsigned=false}={})=>{
  const id=randomUUID();await q('insert into icash_screening_jobs(id,account_id,snapshot) values($1,$2,$3)',[id,account,{propertyId:id}]);
  await q("insert into icash_deal_files(id,account_id,screening_id,terms,stage,seller_signed_at) values($1,$2,$1,$3,$4,case when $4='draft' then null else now() end)",[id,account,{address:'128 Sample Lane, Example City, TX 00000',priceCents:9000000,assignmentFeeCents:1000000,assignee:'Sample Buyer'},unsigned?'draft':buyer?'buyer_selected':'under_contract']);
  const envelopes=[];const phone='+1212555'+String(++contactSequence);
  for(const kind of buyer?['purchase','assignment']:['purchase']){
   const eid=randomUUID(),recipient=kind==='purchase'?phone:'+1312555'+String(++contactSequence);
   await q('insert into icash_signing_envelopes(id,account_id,deal_id,kind,state,provider_id,test_mode,recipients) values($1,$2,$3,$4,$5,$6,$7,$8)',[eid,account,id,kind,unsigned?'awaiting_counterparty':'completed',eid,test,[{id:'1',name:kind==='purchase'?'Sample Seller':'Sample Buyer',phone:recipient,...(kind==='assignment'?{email:'buyer@example.invalid'}:{})},{id:'2',name:'Sample Investor LLC',email:'owner@example.invalid'}]]);
   await q('insert into icash_text_threads(account_id,deal_id,party,recipient,sender) values($1,$2,$3,$4,$5)',[account,id,kind==='purchase'?'seller':'buyer',recipient,'+14243948384']);envelopes.push(eid);
  }
  const perm=randomUUID();await q('insert into icash_contact_permissions values($1,$2)',[perm,account]);
  await q("insert into icash_voice_contact_targets(id,account_id,screening_id,party,phone,contact_key,permission_until,dnc_clear,dnc_checked_at,timezone) values($1,$2,$3,'seller',$4,$5,now()+interval '1 day',false,null,$6)",[perm,account,id,phone,'a'.repeat(64),timezone]);
  return {id,envelopes,phone,perm};
 };
 const preview=id=>rpc('icash_cancellation_preview',{p_account:account,p_actor:actor,p_deal:id});
 const request=async(f,kind='purchase',key=randomUUID())=>rpc('icash_request_cancellation',{p_account:account,p_actor:actor,p_deal:f.id,p_kind:kind,p_reason:'Internal note: assignment fee 10000, never disclose',p_key:key,p_revision:(await preview(f.id)).revision});
 const manual=await fixture({unsigned:true});const intake=randomUUID();
 await q("insert into icash_communication_prices values('sms_segment',2000)");await q("insert into icash_text_senders values('+14243948384',true)");
 await q("update icash_text_threads set paused=true,manual_only=true,ai_mode='off',seller_intake_id=$1,sms_rate_id=$2,permission_evidence='fixture consent',permission_until=now()+interval '1 day',seller_sms_rate_hash=(select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') from icash_operation_rates r where id=$2),seller_sms_price_micros=2000 where deal_id=$3",[intake,emailRate,manual.id]);
 await pg.exec(`create or replace function public.icash_seller_contact_evidence(uuid,uuid,uuid,text) returns jsonb language sql as $$select jsonb_build_object('evidence','fixture consent','timezone','UTC','until',permission_until) from public.icash_text_threads where account_id=$1 and seller_intake_id=$3 and recipient=$4$$`);
 const thread=(await q('select id from icash_text_threads where deal_id=$1',[manual.id])).rows[0].id;
 assert.equal(await rpc('icash_seller_sms_permission_current',{p_account:account,p_thread:thread,p_check_hour:true}),false,'automatic signing stays paused');
 assert.equal(await rpc('icash_manual_signing_sms_current',{p_account:account,p_thread:thread,p_actor:actor}),true,'owner can manually send with unchanged valid source consent');
 assert.equal(await rpc('icash_manual_signing_sms_current',{p_account:account,p_thread:thread,p_actor:other}),false);
 await q('insert into icash_text_suppressions values($1)',[manual.phone]);assert.equal(await rpc('icash_manual_signing_sms_current',{p_account:account,p_thread:thread,p_actor:actor}),false);await q('delete from icash_text_suppressions');
 await q("update icash_text_threads set permission_evidence='changed' where id=$1",[thread]);assert.equal(await rpc('icash_manual_signing_sms_current',{p_account:account,p_thread:thread,p_actor:actor}),false);
 const f=await fixture({buyer:true}),key=randomUUID(),cid=await request(f,'purchase',key);
 assert.equal(await request(f,'purchase',key),cid,'double click returns same cancellation');
 let view=await preview(f.id);assert.equal(view.notices.length,5);assert.equal(view.notices.filter(n=>n.channel==='voice').length,1);assert(!view.notices.some(n=>n.destination==='owner@example.invalid'));
 for(const n of view.notices){assert(!/10000|assignment fee|9000000/.test(n.body));if(n.channel==='sms')assert(n.body.length<=160);}
 const missing=view.notices.find(n=>n.channel==='email'&&n.party==='seller');assert.equal(missing.destination,'');
 await assert.rejects(()=>rpc('icash_cancellation_notice_email',{p_account:account,p_actor:other,p_notice:missing.id,p_email:'seller@example.invalid'}),/Owner required/);
 await rpc('icash_cancellation_notice_email',{p_account:account,p_actor:actor,p_notice:missing.id,p_email:'seller@example.invalid'});
 for(const n of view.notices)await rpc('icash_prepare_cancellation_notice',{p_account:account,p_notice:n.id});
 const rows=(await q('select * from icash_cancellation_notices where cancellation_id=$1',[cid])).rows;
 assert(rows.every(n=>n.sms_id||n.email_id||n.voice_job_id));
 for(const n of rows)await rpc('icash_prepare_cancellation_notice',{p_account:account,p_notice:n.id});
 assert.equal((await q('select count(*)::int n from icash_voice_jobs')).rows[0].n,1,'preparation cannot duplicate calls');
 const voice=rows.find(n=>n.channel==='voice'),op='voice:'+voice.voice_job_id;
 const callContext=await rpc('icash_cancellation_voice_context',{p_account:account,p_job:voice.voice_job_id});
 assert.equal((await rpc('icash_cancellation_voice_context',{p_account:account,p_job:voice.voice_job_id})).completed,false);
 assert.equal(await rpc('icash_cancellation_voice_current',{p_account:other,p_operation:op}),false);
 await q('update icash_accounts set bot_paused=true where id=$1',[account]);assert.equal(await rpc('icash_cancellation_voice_current',{p_account:account,p_operation:op}),false);await q('update icash_accounts set bot_paused=false where id=$1',[account]);
 await q('insert into icash_text_suppressions values($1)',[f.phone]);assert.equal(await rpc('icash_cancellation_voice_current',{p_account:account,p_operation:op}),false);await q('delete from icash_text_suppressions');
 assert.equal(await rpc('icash_cancellation_voice_current',{p_account:account,p_operation:op}),true);
 assert.equal(await rpc('icash_reserve_cancellation_voice',{p_account:account,p_job:voice.voice_job_id,p_context:{...callContext,completed:true}}),null,'stale status cannot dial');
 assert.deepEqual(await rpc('icash_reserve_cancellation_voice',{p_account:account,p_job:voice.voice_job_id,p_context:callContext}),{maxSeconds:120});
 assert.equal((await q('select financial_checked_at from icash_operation_spend where operation_key=$1',[op])).rows[0].financial_checked_at,null,'no invented financial screening');
 assert.equal(await rpc('icash_claim_cancellation_voice',{p_account:account,p_job:voice.voice_job_id,p_context:callContext}),true);
 assert.equal(await rpc('icash_claim_cancellation_voice',{p_account:account,p_job:voice.voice_job_id,p_context:callContext}),false,'single call claim');
 assert.equal(await rpc('icash_retry_cancellation_voice',{p_account:account,p_job:voice.voice_job_id}),false,'a reserved/dispatched call cannot be redialed');
 const email=rows.find(n=>n.party==='buyer'&&n.channel==='email');
 await q('insert into icash_email_suppressions values($1,$2)',[account,email.destination]);assert.equal(await rpc('icash_claim_deal_email',{p_account:account,p_id:email.email_id}),null);await q('delete from icash_email_suppressions');
 await q("update icash_deal_emails set body_text='tampered' where id=$1",[email.email_id]);assert.equal(await rpc('icash_claim_deal_email',{p_account:account,p_id:email.email_id}),null);await q('update icash_deal_emails set body_text=$1 where id=$2',[email.body,email.email_id]);
 assert((await rpc('icash_claim_deal_email',{p_account:account,p_id:email.email_id})).text.includes('does not itself terminate'));
 assert.equal(await rpc('icash_claim_deal_email',{p_account:account,p_id:email.email_id}),null);
 // Required release and provider verification remain intact; completion supersedes only unsent notices.
 assert.equal(await rpc('icash_finish_cancellation',{p_account:account,p_actor:actor,p_id:cid,p_confirmed:false}),false);
 for(const e of f.envelopes)await rpc('icash_record_cancellation_check',{p_account:account,p_actor:actor,p_id:cid,p_envelope:e,p_provider:e,p_outcome:'completed',p_signed:true});
 assert.equal(await rpc('icash_finish_cancellation',{p_account:account,p_actor:actor,p_id:cid,p_confirmed:true,p_release:'Signed fixture release',p_resolution:''}),true);
 view=await preview(f.id);assert.equal(view.notices.filter(n=>n.channel==='voice').length,1,'completion never adds a second call');
 assert.equal(view.notices.filter(n=>n.phase==='completed').length,4);
 assert(view.notices.filter(n=>n.channel==='sms').every(n=>n.body.length<=160));
 assert.equal(view.notices.find(n=>n.phase==='completed'&&n.party==='seller'&&n.channel==='email').destination,'seller@example.invalid');
 const superseded=rows.find(n=>n.channel==='sms');assert.equal(await rpc('icash_claim_customer_text',{p_account:account,p_message:superseded.sms_id,p_sender:'+14243948384'}),null);
 assert.equal((await rpc('icash_cancellation_voice_context',{p_account:account,p_job:voice.voice_job_id})).completed,true);
 const assignment=await fixture({buyer:true});await request(assignment,'assignment');const av=await preview(assignment.id);assert.equal(av.notices.length,2);assert(av.notices.every(n=>n.party==='buyer'&&n.channel!=='voice'),'assignment cancellation never contacts seller or calls buyer');
 const test=await fixture({test:true});await request(test);assert.equal((await preview(test.id)).notices.length,0,'test signing never queues real notices');
 await assert.rejects(()=>rpc('icash_cancellation_preview',{p_account:account,p_actor:other,p_deal:f.id}),/Owner required/);
 for(const role of ['anon','authenticated'])assert.equal((await q("select has_table_privilege($1,'icash_cancellation_notices','SELECT,INSERT,UPDATE,DELETE') allowed",[role])).rows[0].allowed,false);
 // Exercise the real worker against actual queue claims with fake provider adapters.
 const providerCalls=[];const {processCancellationNotices}=await loadService('lib/cancellation-notice-service.ts',{});
 const send=channel=>async(a,id)=>{assert.equal(a,account);providerCalls.push({channel,id});if(channel==='sms')await q("update icash_text_messages set state='accepted' where id=$1",[id]);if(channel==='email')await q("update icash_deal_emails set state='accepted' where id=$1",[id]);return {status:channel==='sms'?'message_accepted':'email_accepted'};};
 const deps={db,text:send('sms'),email:send('email'),voice:async()=>{throw Error('No repeat call allowed');}};
 await processCancellationNotices(deps);assert(providerCalls.length>0);const sends=providerCalls.length;await processCancellationNotices(deps);assert.equal(providerCalls.length,sends,'lease and receipts prevent duplicate worker sends');
 const prompt=cancellationCallPrompt({address:'Sample property',body:'Cancellation requested',completed:false},'Sample investor','Sample bot');assert.match(prompt,/sole task is one brief cancellation update/);assert.match(prompt,/Never make an offer/);assert.match(prompt,/voicemail/);
 assert.equal(cancellationNoticeLabel({channel:'email',state:'accepted',detail:''}),'Accepted for delivery');assert.match(cancellationNoticeLabel({channel:'voice',state:'call_ended',detail:''}),/check conversation/);
 console.log('PASS cancellation notifications: actual migration, ownership, recipient scope, missing email, idempotency, signed release, cancellation completion race, privacy, suppression, paid-call binding, pause, bounded call, no redial and worker replay. No live provider work.');
}catch(error){console.error(error.message,error.where??'',error.position?`SQL position ${error.position}`:'');process.exitCode=1;}finally{await pg.close();}
