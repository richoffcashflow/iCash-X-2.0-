// Disposable PostgreSQL, stored-source fixtures only. No network/provider calls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const fn=(path,name)=>{const s=read(path),start=s.indexOf(`create function public.${name}(`);assert(start>=0,name);return s.slice(start,s.indexOf('$$;',start)+3);};
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('NETWORK BLOCKED: local seller response fixtures only');};
const pg=await PGlite.create(),q=(s,p=[])=>pg.query(s,p),one=async(s,p=[])=>(await q(s,p)).rows[0];
const isolated=async f=>{await pg.exec('begin');try{await f();}finally{await pg.exec('rollback');}};
try{
 await pg.exec(`
 create role anon;create role authenticated;create role service_role bypassrls;
 create table icash_operating_budget(id int primary key);insert into icash_operating_budget values(1);
 create table icash_accounts(id uuid primary key);
 create table icash_screening_jobs(id uuid primary key,account_id uuid,snapshot jsonb);
 create table icash_property_controls(account_id uuid,property_id text,manual boolean,updated_at timestamptz default now(),primary key(account_id,property_id));
 create table icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid,terms jsonb,stage text default 'draft');
 create table icash_text_threads(id uuid primary key,account_id uuid,deal_id uuid,recipient text,party text,paused boolean default false,seller_intake_id uuid);
 create table icash_text_messages(id uuid primary key,account_id uuid,thread_id uuid,direction text,state text,body text,event_id text,provider_id text,customer_author_id uuid,created_at timestamptz default now(),updated_at timestamptz default now());
 create table icash_text_ai_jobs(id uuid primary key,account_id uuid,thread_id uuid,state text,updated_at timestamptz default now());
 create table icash_contact_permissions(id uuid primary key,account_id uuid,screening_id uuid,party text,phone text,contact_key text,revoked_at timestamptz,seller_intake_id uuid);
 create table icash_operational_contacts(like icash_contact_permissions);
 create view icash_voice_contact_targets as select * from icash_contact_permissions union all select * from icash_operational_contacts;
 create table icash_voice_jobs(id uuid primary key,account_id uuid,permission_id uuid,operational_contact_id uuid,state text,provider_call_sid text,conversation_id text,cancellation_notice_id uuid,outcome text,updated_at timestamptz default now());
 create table icash_operation_spend(operation_key text primary key,account_id uuid,state text,dispatched_at timestamptz);
 create table icash_live_conversations(id uuid primary key,account_id uuid,screening_id uuid,contact_key text,party text,state text,result jsonb,completed_at timestamptz);
 create table icash_live_callbacks(id uuid primary key,account_id uuid,screening_id uuid,conversation_id uuid,state text);
 create table icash_meta_leads(lead_id uuid,account_id uuid,screening_id uuid,paused boolean default false,voice_paused boolean default false,declined_at timestamptz,response_at timestamptz,response_channel text,first_outreach_at timestamptz);
 create table icash_seller_intakes(id uuid primary key,phone text,email text,hold_reason text);
 create table icash_seller_matches(lead_id uuid,account_id uuid,screening_id uuid);
 create table icash_signing_envelopes(id uuid,account_id uuid,deal_id uuid,kind text,state text,test_mode boolean,recipients jsonb);
 create table icash_deal_emails(subject text,id uuid primary key default gen_random_uuid(),account_id uuid,deal_id uuid,direction text,contact_key text,recipient text,body_text text,state text,provider_id uuid unique,reply_to_id uuid,created_at timestamptz default now(),updated_at timestamptz default now());
 create table icash_seller_email_openers(email_id uuid,account_id uuid);
 create table icash_text_suppressions(phone text primary key,reason text);
 create table icash_contact_suppressions(account_id uuid,contact_key text,source_conversation uuid,primary key(account_id,contact_key));
 create table icash_email_suppressions(account_id uuid,email text,reason text,primary key(account_id,email));
 create schema icash_seller_agreement_private;
 create table icash_seller_agreement_private.call_history(session_id uuid primary key,account_id uuid,screening_id uuid,contact_key text,completed_at timestamptz,transcript jsonb);
 create function public.icash_deal_email_contacts(p_account uuid,p_deal uuid) returns table(contact_key text,email text,party text) language sql as $$
 select 'seller-lead:'||l.id,lower(l.email),'seller' from public.icash_seller_intakes l join public.icash_seller_matches m on m.lead_id=l.id join public.icash_deal_files d on d.account_id=m.account_id and d.screening_id=m.screening_id where d.id=p_deal and d.account_id=p_account$$;
 create table fixture_claims(n integer default 0);insert into fixture_claims default values;
 create function icash_claim_operation(p_operation text) returns boolean language plpgsql as $$begin update public.fixture_claims set n=n+1;return true;end$$;
 create function icash_transition_call_recording(p_id uuid,p_account uuid,p_operation text,p_expected_state text,p_action text,p_payload jsonb) returns jsonb language plpgsql as $$declare r record;begin select p_account account_id,p_operation operation_key into r;if p_action='claim_dial' then return '{"dial":true}'::jsonb;end if;return '{"reconciled":true}'::jsonb;end$$;
 create function icash_save_live_result(p_call uuid,p_result jsonb) returns void language plpgsql as $$declare c public.icash_live_conversations;begin select * into c from public.icash_live_conversations where id=p_call;if (p_result->>'optedOut')::boolean then insert into public.icash_contact_suppressions(account_id,contact_key,source_conversation) values(c.account_id,c.contact_key,c.id) on conflict do nothing;end if;update public.icash_live_conversations set result=p_result,state='complete',completed_at=now() where id=p_call;end$$;
 create function icash_seller_conversation_human(text) returns boolean language sql immutable as $$select false$$;
 `);
 // Apply the exact deployed network-pool expansion to the real observer.
 const poolBinding='t.seller_intake_id=m.lead_id and (t.account_id=m.account_id or exists(select 1 from public.icash_seller_matches sm where sm.lead_id=m.lead_id and sm.account_id=t.account_id and sm.screening_id=(select d.screening_id from public.icash_deal_files d where d.id=t.deal_id and d.account_id=t.account_id)))';
 assert(read('config/meta-instant-network-pool.sql').includes(poolBinding));
 await pg.exec(fn('config/meta-instant-lead-work.sql','icash_meta_observe_text').replace('t.seller_intake_id=m.lead_id and t.account_id=m.account_id',poolBinding));
 await pg.exec(fn('config/seller-gap-recovery.sql','icash_seller_gap_reason'));
 await pg.exec(fn('config/reply-signals.sql','icash_text_signal'));
 const human=read('config/homeoffer-meta-events.sql');const hs=human.indexOf('create or replace function public.icash_seller_human_answer');await pg.exec(human.slice(hs,human.indexOf('$$;',hs)+3));
 await pg.exec(read('config/text-stop-voice.sql'));
 await pg.exec(read('config/seller-response-policy.sql'));
 await pg.exec(read('config/seller-optout-base-verbs.sql'));
 await pg.exec(read('config/seller-natural-refusals.sql'));
 await pg.exec(read('config/seller-negative-response-holds.sql'));
 await pg.exec(fn('config/manual-deal-email.sql','icash_record_deal_email_reply'));
 await pg.exec('create trigger fixture_meta_observe_text after insert or update of state,provider_id on icash_text_messages for each row execute function icash_meta_observe_text()');
 const a=randomUUID(),b=randomUUID(),screen=randomUUID(),otherScreen=randomUUID(),deal=randomUUID(),otherDeal=randomUUID(),thread=randomUUID(),otherThread=randomUUID(),permission=randomUUID(),otherPermission=randomUUID(),lead=randomUUID();
 const phone='+12145550123',email='seller@example.invalid',hash=(await one("select encode(sha256(convert_to($1,'UTF8')),'hex') h",[phone])).h;
 await q('insert into icash_accounts values($1),($2)',[a,b]);
 await q(`insert into icash_screening_jobs values($1,$2,'{"propertyId":"property-a"}'),($3,$4,'{"propertyId":"property-b"}')`,[screen,a,otherScreen,b]);
 await q(`insert into icash_deal_files(id,account_id,screening_id,terms) values($1,$2,$3,'{}'),($4,$5,$6,'{}')`,[deal,a,screen,otherDeal,b,otherScreen]);
 await q("insert into icash_seller_intakes(id,phone,email) values($1,$2,$3)",[lead,phone,email]);
 await q('insert into icash_seller_matches values($1,$2,$3),($1,$4,$5)',[lead,a,screen,b,otherScreen]);
 await q("insert into icash_text_threads(id,account_id,deal_id,recipient,party,seller_intake_id) values($1,$2,$3,$4,'seller',$5),($6,$7,$8,$4,'seller',$5)",[thread,a,deal,phone,lead,otherThread,b,otherDeal]);
 await q("insert into icash_contact_permissions(id,account_id,screening_id,party,phone,contact_key,seller_intake_id) values($1,$2,$3,'seller',$4,$5,$6),($7,$8,$9,'seller',$4,$5,$6)",[permission,a,screen,phone,hash,lead,otherPermission,b,otherScreen]);
 const outgoing=randomUUID(),attemptedText=randomUUID(),manualText=randomUUID(),job=randomUUID(),reservedJob=randomUUID(),unknownJob=randomUUID(),call=randomUUID(),callback=randomUUID(),ai=randomUUID(),mail=randomUUID();
 await q("insert into icash_text_messages(id,account_id,thread_id,direction,state,body,provider_id,customer_author_id) values($1,$2,$3,'outgoing','ready','Follow up',null,null),($4,$2,$3,'outgoing','dispatching','Already claimed',null,null),($5,$2,$3,'outgoing','ready','Human reply',null,$6)",[outgoing,a,thread,attemptedText,manualText,randomUUID()]);
 await q("insert into icash_text_ai_jobs values($1,$2,$3,'pending',now())",[ai,a,thread]);
 await q("insert into icash_voice_jobs(id,account_id,permission_id,state,outcome) values($1,$2,$3,'ready',null),($4,$2,$3,'issued',null),($5,$2,$3,'held','provider_outcome_unknown_no_retry')",[job,a,permission,reservedJob,unknownJob]);
 await q("insert into icash_operation_spend values($1,$2,'reserved',null),($3,$2,'reserved',null),($4,$2,'reserved',null)",['voice:'+reservedJob,a,'text:'+outgoing,'sms-ai:'+ai]);
 await q("insert into icash_live_conversations values($1,$2,$3,$4,'seller','waiting',null,null)",[call,a,screen,hash]);
 await q("insert into icash_live_callbacks values($1,$2,$3,$4,'pending_dispatch_review')",[callback,a,screen,call]);
 await q("insert into icash_deal_emails(id,account_id,deal_id,direction,contact_key,recipient,body_text,state) values($1,$2,$3,'outgoing',$4,$5,'Opening','ready')",[mail,a,deal,'seller-lead:'+lead,email]);
 await q('insert into icash_seller_email_openers values($1,$2)',[mail,a]);
 const sms=async(body,opts={})=>{const id=randomUUID();await q("insert into icash_text_messages(id,account_id,thread_id,direction,state,body,event_id) values($1,$2,$3,'incoming','received',$4,$5)",[id,opts.account??a,opts.thread??thread,body,randomUUID()]);return id;};
 const allowed=async op=>(await one('select icash_seller_response_operation_allowed($1,$2) allowed',[a,op])).allowed;
 const stopped=async()=>{
  assert.equal((await one('select manual from icash_property_controls where account_id=$1',[a])).manual,true);
  assert.equal((await one('select count(*) n from icash_property_controls where account_id=$1',[b])).n,0,'soft pause is tenant scoped');
  assert.equal((await one('select paused from icash_text_threads where id=$1',[thread])).paused,true);
  assert.equal((await one('select state from icash_text_messages where id=$1',[outgoing])).state,'cancelled');
  assert.equal((await one('select state from icash_text_messages where id=$1',[attemptedText])).state,'dispatching');
  assert.equal((await one('select state from icash_text_messages where id=$1',[manualText])).state,'ready');
  assert.equal((await one('select state from icash_text_ai_jobs where id=$1',[ai])).state,'superseded');
  assert.equal((await one('select state from icash_voice_jobs where id=$1',[job])).state,'held');
  assert.equal((await one('select state from icash_voice_jobs where id=$1',[reservedJob])).state,'issued','reserved worker retains ownership');
  assert.equal((await one('select outcome from icash_voice_jobs where id=$1',[unknownJob])).outcome,'provider_outcome_unknown_no_retry');
  assert.equal((await one('select state from icash_live_callbacks where id=$1',[callback])).state,'canceled');
  assert.equal((await one('select state from icash_deal_emails where id=$1',[mail])).state,'needs_review');
  for(const op of ['voice:'+reservedJob,'text:'+outgoing,'sms-ai:'+ai,'deal-email:'+mail])assert.equal(await allowed(op),false,op);
  assert.equal(await allowed('text:'+manualText),true,'existing manual reply checks stay downstream');
  assert.equal((await one('select icash_claim_operation($1) claimed',['voice:'+reservedJob])).claimed,false);
  assert.equal((await one('select n from fixture_claims')).n,0,'blocked before prior spend claim');
  assert.equal((await one("select icash_transition_call_recording($1,$2,$3,'consent_pending','claim_dial','{}') result",[randomUUID(),a,'voice:'+reservedJob])).result,null,'last provider dial is blocked after spend claim');
  assert.deepEqual((await one("select icash_transition_call_recording($1,$2,$3,'recording','reconcile','{}') result",[randomUUID(),a,'voice:'+reservedJob])).result,{reconciled:true});
  assert.equal((await one('select stage from icash_deal_files where id=$1',[deal])).stage,'draft','no invented legal cancellation');
 };
 for(const text of ['I have told yall NO','I am tired of these texts','not super interested','This sounds like a scam','not a scam?'])await isolated(async()=>{await sms(text);await stopped();assert.equal((await one('select count(*) n from icash_text_suppressions')).n,0);});
 for(const text of ['The roof is terrible and the house needs repairs','not a scam, happy to proceed',"I never said not interested, I want to sell",'You wrote STOP in your message'])await isolated(async()=>{await sms(text);assert.equal((await one('select count(*) n from icash_property_controls')).n,0,text);assert.equal((await one("select icash_text_signal($1,'seller') signal",[text])).signal,null,text);});
 for(const body of ['Stop asking me cause I will not fucking sale shit','I am tired of these texts. Stop.','STOP','Stop text me','Stop contact me','Stop call me','Stop message me'])await isolated(async()=>{await sms(body);assert.equal((await one('select count(*) n from icash_text_suppressions')).n,1);assert.equal((await one('select count(*) n from icash_email_suppressions')).n,2,'exact shared phone opt-out propagates to its bound emails');assert.equal((await one('select revoked_at is not null revoked from icash_contact_permissions where id=$1',[permission])).revoked,true);assert.equal(await allowed('text:'+manualText),false,'manual sends never bypass permanent suppression');});
 await isolated(async()=>{await sms('not interested',{account:b,thread});assert.equal((await one('select count(*) n from icash_property_controls')).n,0,'mismatched source tenant ignored');});
 await isolated(async()=>{await q("update icash_deal_files set terms='{\"practice\":true}' where id=$1",[deal]);await sms('STOP');assert.equal((await one('select count(*) n from icash_text_suppressions')).n,0,'practice source is excluded');});
 for(const source of ['call','inbound_call'])await isolated(async()=>{
  const transcript=[{role:'agent',message:'Would you consider selling?'},{role:'user',message:'Not super interested'}];
  if(source==='call')await q("select icash_save_live_result($1,$2)",[call,{transcript,optedOut:false}]);
  else await q('insert into icash_seller_agreement_private.call_history values($1,$2,$3,$4,now(),$5)',[randomUUID(),a,screen,hash,JSON.stringify(transcript)]);
  await stopped();assert.equal((await one('select count(*) n from icash_text_suppressions')).n,0);
 });
 await isolated(async()=>{await q('select icash_save_live_result($1,$2)',[call,{optedOut:true,transcript:[{role:'user',message:'The roof is bad but I want to sell'}]}]);assert.equal((await one('select count(*) n from icash_contact_suppressions')).n,0,'seller model flag alone is not DNC');assert.equal((await one('select count(*) n from icash_property_controls')).n,0);});
 for(const text of ['not super interested','unsubscribe','Hi,\n\nPlease unsubscribe.','Happy to proceed\n\n> unsubscribe'])await isolated(async()=>{
  await q("update icash_deal_emails set state='accepted',provider_id=$2 where id=$1",[mail,randomUUID()]);
  await q("insert into icash_deal_emails(id,account_id,deal_id,direction,contact_key,recipient,body_text,state,provider_id,reply_to_id) values($1,$2,$3,'incoming',$4,$5,$6,'received',$7,$8)",[randomUUID(),a,deal,'seller-lead:'+lead,email,text,randomUUID(),mail]);
  if(text==='not super interested'){assert.equal((await one('select manual from icash_property_controls where account_id=$1',[a])).manual,true);assert.equal((await one('select count(*) n from icash_text_suppressions')).n,0);}
  else if(text==='unsubscribe'||text.startsWith('Hi,'))assert.equal((await one('select count(*) n from icash_text_suppressions')).n,1,'authenticated email opt-out reaches its exact bound phone');
  else assert.equal((await one('select count(*) n from icash_property_controls')).n,0,'quoted email history ignored');
 });
 await isolated(async()=>{await q("update icash_deal_emails set state='accepted' where id=$1",[mail]);await q("insert into icash_deal_emails(id,account_id,deal_id,direction,contact_key,recipient,body_text,state,provider_id,reply_to_id) values($1,$2,$3,'incoming',$4,'attacker@example.invalid','STOP','received',$5,$6)",[randomUUID(),a,deal,'seller-lead:'+lead,randomUUID(),mail]);assert.equal((await one('select count(*) n from icash_text_suppressions')).n,0,'sender/reference mismatch cannot stop another contact');});
 await isolated(async()=>{await sms('not interested');await q('update icash_voice_jobs set cancellation_notice_id=$2 where id=$1',[reservedJob,randomUUID()]);assert.equal(await allowed('voice:'+reservedJob),true,'verified cancellation still needs its existing downstream checks');});
 await isolated(async()=>{await q('insert into icash_contact_suppressions values($1,$2,$3)',[a,hash,call]);assert.equal(await allowed('deal-email:'+mail),false,'historical call suppression stops the bound email without needing replay');});
 await isolated(async()=>{await q('insert into icash_meta_leads(lead_id,account_id,screening_id) values($1,$2,$3)',[lead,a,screen]);await sms('not a scam?');assert.equal((await one('select paused from icash_meta_leads')).paused,true);assert.equal((await one('select declined_at from icash_meta_leads')).declined_at,null);assert.equal((await one('select icash_meta_call_outcome($1) outcome',[{transcript:[{role:'user',message:'not a scam?'}]}])).outcome,'review');});
 await isolated(async()=>{
  await q('insert into icash_meta_leads(lead_id,account_id,screening_id) values($1,$2,$3)',[lead,a,screen]);
  await sms('I did not say stop calling');assert.equal((await one('select voice_paused from icash_meta_leads')).voice_paused,false);
  await sms('You wrote only text in your message');assert.equal((await one('select voice_paused from icash_meta_leads')).voice_paused,false);
  await sms('Please text me only');assert.equal((await one('select voice_paused from icash_meta_leads')).voice_paused,true);
  assert.equal((await one('select state from icash_voice_jobs where id=$1',[reservedJob])).state,'issued','text-only never rewrites reserved job');
  assert.equal((await one('select outcome from icash_voice_jobs where id=$1',[unknownJob])).outcome,'provider_outcome_unknown_no_retry');
 });
 await isolated(async()=>{
  await q("update icash_deal_emails set state='accepted' where id=$1",[mail]);
  await q('select icash_record_deal_email_reply($1,$2,$3,$4,$5,false)',[randomUUID(),mail,email,'Re: property','Hi,\n\nPlease unsubscribe.']);
  assert.equal((await one('select count(*) n from icash_text_suppressions')).n,0,'unauthenticated sender cannot create an incoming source');
  await q('select icash_record_deal_email_reply($1,$2,$3,$4,$5,true)',[randomUUID(),mail,email,'Re: property','Hi,\n\nPlease unsubscribe.']);
  assert.equal((await one('select count(*) n from icash_text_suppressions')).n,1,'real authenticated email ingestion reaches the cross-channel stop');
 });
 for(const text of ['not interested','not a scam?'])await isolated(async()=>{
  await q('insert into icash_meta_leads(lead_id,account_id,screening_id) values($1,$2,$3)',[lead,a,screen]);
  await sms(text,{account:b,thread:otherThread});
  assert.equal((await one('select paused from icash_meta_leads')).paused,false,'matched reply does not pause canonical account');
  assert.equal((await one('select declined_at from icash_meta_leads')).declined_at,null);
  assert.equal((await one('select count(*) n from icash_property_controls where account_id=$1',[a])).n,0);
  assert.equal((await one('select manual from icash_property_controls where account_id=$1',[b])).manual,true);
  assert.equal((await one('select state from icash_voice_jobs where id=$1',[job])).state,'ready');
 });
 await isolated(async()=>{
  await q('insert into icash_meta_leads(lead_id,account_id,screening_id) values($1,$2,$3)',[lead,a,screen]);
  const pooledReady=randomUUID(),pooledReserved=randomUUID(),pooledFuture=randomUUID();
  await q("insert into icash_voice_jobs(id,account_id,permission_id,state) values($1,$2,$3,'ready'),($4,$2,$3,'issued')",[pooledReady,b,otherPermission,pooledReserved]);
  await q("insert into icash_operation_spend values($1,$2,'reserved',null)",['voice:'+pooledReserved,b]);
  for(const text of ['I did not say stop calling','You wrote only text in your message']){
   await sms(text,{account:b,thread:otherThread});assert.equal((await one('select voice_paused from icash_meta_leads')).voice_paused,false,'quoted/negated pooled words do not change channel preference');
   assert.equal((await one('select icash_seller_response_operation_allowed($1,$2) allowed',[b,'voice:'+pooledReserved])).allowed,true);
  }
  await sms('Please text me only',{account:b,thread:otherThread});
  assert.equal((await one('select voice_paused from icash_meta_leads')).voice_paused,true,'direct channel preference survives pooled assignment');
  assert.equal((await one('select paused from icash_meta_leads')).paused,false,'text-only does not fabricate a soft decline');
  assert.equal((await one('select count(*) n from icash_property_controls')).n,0);
  assert.equal((await one('select count(*) n from icash_text_suppressions')).n,0);
  assert.equal((await one('select paused from icash_text_threads where id=$1',[otherThread])).paused,false,'SMS stays available');
  assert.equal((await one('select state from icash_voice_jobs where id=$1',[pooledReady])).state,'held');
  assert.equal((await one('select state from icash_voice_jobs where id=$1',[pooledReserved])).state,'issued','reserved work is not rewritten');
  await q("insert into icash_voice_jobs(id,account_id,permission_id,state) values($1,$2,$3,'ready')",[pooledFuture,b,otherPermission]);
  for(const id of [pooledReserved,pooledFuture]){
   assert.equal((await one('select icash_seller_response_operation_allowed($1,$2) allowed',[b,'voice:'+id])).allowed,false,'pooled current/future voice admission respects text-only');
   assert.equal((await one("select icash_transition_call_recording($1,$2,$3,'consent_pending','claim_dial','{}') result",[randomUUID(),b,'voice:'+id])).result,null);
  }
  assert.equal((await one('select icash_claim_operation($1) claimed',['voice:'+pooledReserved])).claimed,false);
  assert.equal((await one('select n from fixture_claims')).n,0);
 });
 await pg.exec('set role anon');await assert.rejects(()=>q('select icash_apply_seller_response($1,$2)',['sms',randomUUID()]),/permission denied/);await pg.exec('reset role');
 assert.equal(read('config/seller-negative-response-holds.sql'),read('supabase/migrations/20261019183500_seller_negative_response_holds.sql'));
 console.log('Seller negative-response SQL fixtures passed: source binding, all channels, queued/final admission, permanent opt-out, tenant isolation and uncertain-provider preservation. No network or production access.');
}finally{await pg.close();globalThis.fetch=originalFetch;}
