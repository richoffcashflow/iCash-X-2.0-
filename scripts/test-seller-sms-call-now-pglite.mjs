// SIMULATION ONLY. In-memory PostgreSQL with synthetic consent/spend delegates.
// Uses the real new SQL, source enqueue/capture triggers and route CAS. No network.
import assert from 'node:assert/strict';
process.on('uncaughtException',error=>{console.error(error.message, error.where??'',error.position??'',error.query?.slice(0,500)??'');process.exit(1);});
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
if(!process.argv[2])throw Error('Pass local @electric-sql/pglite/dist/index.js');
const {PGlite}=await import(pathToFileURL(process.argv[2]).href),pg=await PGlite.create();
const q=(sql,args=[])=>pg.query(sql,args),one=async(sql,args=[])=>(await q(sql,args)).rows[0];
const read=name=>readFileSync(new URL('../config/'+name+'.sql',import.meta.url),'utf8');
const sourceFunction=(file,name)=>{const sql=read(file),start=sql.indexOf('create function public.'+name+'(');assert(start>=0,name);const end=sql.indexOf('end $$;',start);const sqlEnd=sql.indexOf('\n$$;',start);return sql.slice(start,Math.min(...[end<0?Infinity:end+7,sqlEnd<0?Infinity:sqlEnd+4]));};
const account=randomUUID(),other=randomUUID(),thread=randomUUID(),job=randomUUID(),incoming=randomUUID(),deal=randomUUID(),screen=randomUUID(),lead=randomUUID();
await pg.exec(`create role anon;create role authenticated;create role service_role;
create table icash_operating_budget(id integer);insert into icash_operating_budget values(1);
create table icash_accounts(id uuid primary key,assistant_name text,bot_paused boolean default false);
create table icash_customer_identities(account_id uuid,principal text);
create table icash_text_threads(id uuid primary key,account_id uuid,deal_id uuid,party text,recipient text,sender text,seller_intake_id uuid,paused boolean default false,manual_only boolean default false,ai_mode text default 'auto',retired_at timestamptz,timezone text default 'America/Chicago',dnc_checked_at timestamptz);
create table icash_text_messages(id uuid primary key default gen_random_uuid(),account_id uuid,thread_id uuid,direction text,state text,body text,attachments jsonb default '[]',provider_id text,event_id text,request_key uuid unique,route_revision bigint,created_at timestamptz default now(),updated_at timestamptz default now());
create table icash_text_ai_jobs(id uuid primary key default gen_random_uuid(),account_id uuid,thread_id uuid,message_id uuid unique,state text default 'pending',analysis jsonb,reply text,outgoing_id uuid,created_at timestamptz default now(),updated_at timestamptz default now());
create table icash_text_suppressions(phone text);
create table icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid,stage text,terms jsonb);
create table icash_screening_jobs(id uuid primary key,account_id uuid,state text,snapshot jsonb,result jsonb,completed_at timestamptz);
create table icash_property_controls(account_id uuid,property_id text,manual boolean,updated_at timestamptz,unique(account_id,property_id));
create table icash_handoffs(account_id uuid,screening_id uuid,state text);
create table icash_sms_routes(sender text,recipient text,account_id uuid,revision bigint default 1,needs_review boolean default false,primary key(sender,recipient));
create table icash_text_events(id text,payload jsonb);
create table icash_text_attention(id uuid primary key default gen_random_uuid(),account_id uuid,thread_id uuid,deal_id uuid,screening_id uuid,message_id uuid,kind text,party text,quote text,timezone text,state text default 'open',created_at timestamptz default now(),updated_at timestamptz default now(),unique(thread_id,kind));
create table icash_contact_permissions(id uuid primary key,account_id uuid,screening_id uuid,party text,phone text,seller_intake_id uuid);
create table icash_voice_jobs(id uuid primary key,account_id uuid,permission_id uuid,state text,outcome text,updated_at timestamptz default now());
create function icash_claim_reviewed_voice_job(p_job uuid,p_offer_snapshot jsonb default null,p_buyer_snapshot jsonb default null) returns boolean language plpgsql set search_path=public as $$begin update fixture_policy set voice_claim_calls=voice_claim_calls+1;update icash_voice_jobs set state='dispatching' where id=p_job and state='issued';return found;end$$;
create function icash_claim_limited_seller_voice(p_job uuid,p_snapshot jsonb) returns boolean language plpgsql set search_path=public as $$begin update fixture_policy set limited_claim_calls=limited_claim_calls+1;update icash_voice_jobs set state='dispatching' where id=p_job and state='issued';return found;end$$;
create table icash_outreach_campaigns(account_id uuid,mode text);
create table icash_sms_inbound_invitations(account_id uuid,thread_id uuid,deal_id uuid,message_id uuid,called_number text,sender text,recipient text,expires_at timestamptz,reply_id uuid);
create table icash_sms_seller_openings(thread_id uuid,owner_question_id uuid);
create table icash_seller_opener_assignments(account_id uuid,message_id uuid);
create table icash_inbound_voice_routes(called_number text,business_number text,enabled boolean,reviewed_until timestamptz,agent_config_hash text);
create function icash_customer_authored_text(a uuid,m uuid) returns boolean language sql as $$select false$$;
create function icash_seller_limited_contact(a uuid,s uuid) returns boolean language sql as $$select false$$;
create function icash_manual_handoff_reply(a uuid,t uuid) returns boolean language sql as $$select false$$;
create function icash_buyer_factual_text(a uuid,t uuid,b text) returns text language sql as $$select 'AI assistant: Fixture buyer price.'::text$$;
create function icash_buyer_package_data(a uuid,d uuid) returns jsonb language sql as $$select '{"fixture":"buyer package"}'::jsonb$$;
create table fixture_policy(permitted boolean default true,evidence boolean default true,dispatch boolean default true,queue boolean default true,analysis_allowed boolean default true,campaign boolean default true,legacy_calls integer default 0,claim_calls integer default 0,voice_claim_calls integer default 0,limited_claim_calls integer default 0);
insert into fixture_policy default values;
create function icash_seller_sms_permission_current(a uuid,t uuid,h boolean) returns boolean language sql set search_path=public as $$select permitted from fixture_policy$$;
create function icash_seller_contact_evidence(a uuid,s uuid,l uuid,p text) returns jsonb language sql set search_path=public as $$select case when evidence then '{"evidence":"SIMULATION current bound consent"}'::jsonb else null end from fixture_policy$$;
create function icash_sms_thread_review_current(a uuid,t uuid,h boolean) returns boolean language sql set search_path=public as $$select permitted from fixture_policy$$;
create function icash_sms_inbound_campaign_current(a uuid) returns boolean language sql set search_path=public as $$select campaign from fixture_policy$$;
create function icash_outreach_sms_current(a uuid) returns boolean language sql set search_path=public as $$select campaign from fixture_policy$$;
create function icash_prepare_sms_inbound_reply(a uuid,t uuid,m uuid) returns uuid language plpgsql set search_path=public as $$begin update fixture_policy set legacy_calls=legacy_calls+1;return null;end$$;
create function icash_queue_text(a uuid,t uuid,k uuid,b text,assets uuid[]) returns uuid language plpgsql set search_path=public as $$declare out_id uuid;begin if not (select queue from fixture_policy) then return null;end if;if length(b)>160 or (b ~ '[^A-Za-z0-9 .,!?]' and length(b)>35) then raise exception 'Shorten the message';end if;insert into icash_text_messages(account_id,thread_id,direction,state,body,request_key) values(a,t,'outgoing','ready',b,k) returning id into out_id;return out_id;end$$;
create function icash_claim_text_before_campaign(a uuid,m uuid,s text) returns jsonb language plpgsql set search_path=public as $$begin update fixture_policy set claim_calls=claim_calls+1;return case when (select dispatch from fixture_policy) then '{"fixture":"existing dispatch delegate"}'::jsonb else null end;end$$;
create function icash_claim_text(p_account uuid,p_message uuid,p_sender text) returns jsonb language plpgsql set search_path='' as $$begin
 if not public.icash_sms_message_route_current(p_account,p_message) then return null;end if;
 return public.icash_claim_text_before_owner_question(p_account,p_message,p_sender);end$$;
create function icash_claim_text_ai_before_campaign(a uuid,j uuid) returns jsonb language plpgsql set search_path=public as $$begin if not (select analysis_allowed from fixture_policy) then return null;end if;update icash_text_ai_jobs set state='analyzing' where id=j and account_id=a and state='issued';if not found then return null;end if;return '{"model":"fixture","context":{},"messages":[]}'::jsonb;end$$;
create function icash_claim_text_ai(p_account uuid,p_job uuid) returns jsonb language plpgsql set search_path='' as $$begin
 if exists(select 1 from public.icash_outreach_campaigns where account_id=p_account and mode='sms_inbound')
 and not exists(select 1 from public.icash_text_ai_jobs j join public.icash_text_threads t on t.id=j.thread_id and t.account_id=j.account_id where j.id=p_job and j.account_id=p_account and t.party='buyer') then return null;end if;return public.icash_claim_text_ai_before_campaign(p_account,p_job);end$$;
grant usage on schema public to service_role;grant all on all tables in schema public to service_role;grant execute on all functions in schema public to service_role;`);
// The real current campaign wrapper. Only its lower spend/provider chain is stubbed.
// The buyer exception is applied exactly as the subsequent buyer policy migration.
{
 const source=read('seller-limited-contact');
 const start=source.indexOf('CREATE OR REPLACE FUNCTION public.icash_claim_text_before_owner_question(');
 const end=source.indexOf('end $function$',start)+'end $function$'.length;
 assert(start>=0&&end>start);
 let definition=source.slice(start,end)+';';
 const buyerPolicy=read('buyer-factual-text-replies');
 const patchStart=buyerPolicy.indexOf("definition:=pg_get_functiondef('public.icash_claim_text_before_owner_question");
 const oldMatch=buyerPolicy.slice(patchStart).match(/needle:=\$old\$([\s\S]*?)\$old\$;/);
 const newMatch=buyerPolicy.slice(patchStart).match(/replacement:=\$new\$([\s\S]*?)\$new\$;/);
 assert(oldMatch&&newMatch&&definition.includes(oldMatch[1]));
 definition=definition.replace(oldMatch[1],newMatch[1]);
 await pg.exec(definition);
}
await pg.exec(sourceFunction('text-ai','icash_enqueue_text_ai'));
await pg.exec(sourceFunction('reply-signals','icash_text_signal'));
await pg.exec(sourceFunction('reply-signals','icash_capture_text_signal'));
await pg.exec(`do $$declare d text;needle text:=' if new.direction<>''incoming'' or new.account_id is null or new.thread_id is null then return new;end if;';begin d:=pg_get_functiondef('icash_enqueue_text_ai()'::regprocedure);execute replace(d,needle,needle||E'\n if public.icash_outreach_sms_current(new.account_id) then perform public.icash_prepare_sms_inbound_reply(new.account_id,new.thread_id,new.id);return new;end if;\n if exists(select 1 from public.icash_text_threads where id=new.thread_id and account_id=new.account_id and paused) then return new;end if;');end$$;`);
await pg.exec(sourceFunction('sms-property-routing','icash_sms_message_route'));
await pg.exec(sourceFunction('sms-property-routing','icash_sms_message_route_current'));
await pg.exec(`create trigger icash_00_sms_message_route before insert or update on icash_text_messages for each row execute function icash_sms_message_route();
create trigger icash_00_capture_text_signal after insert on icash_text_messages for each row execute function icash_capture_text_signal();
create trigger icash_text_ai_incoming after insert on icash_text_messages for each row execute function icash_enqueue_text_ai();`);
await pg.exec(read('sms-call-requests'));
await pg.exec(read('seller-conversation-continuation'));
const actor=randomUUID(),permission=randomUUID();
await pg.exec(`
alter table icash_accounts add owner_user_id uuid;
alter table icash_contact_permissions add contact_key text;
alter table icash_voice_jobs alter id set default gen_random_uuid(),alter state set default 'ready',
 add callback_id uuid,add operational_contact_id uuid,add operation_key text,add due_at timestamptz default now(),add created_at timestamptz default now();
create unique index icash_voice_first_once on icash_voice_jobs(permission_id) where callback_id is null;
create table icash_contact_suppressions(contact_key text);
create table icash_live_conversations(contact_key text,state text);
create table icash_call_recordings(account_id uuid,voice_job_id uuid,contact_key text,call_sid text,call_ended_at timestamptz,created_at timestamptz default now());
create function icash_seller_voice_permission_current(a uuid,p uuid) returns boolean language sql set search_path=public as $$select permitted from fixture_policy$$;
create function icash_prepare_seller_text_event(p_event text) returns jsonb language sql as $$select '{"legacy":true}'::jsonb$$;
`);
await pg.exec(read('seller-sms-immediate-callback'));
await pg.exec(read('unstarted-sms-call-recovery'));
// Production has a later viewing wrapper; retain its delegation when patching.
await pg.exec(`alter function icash_seller_conversation_reply(uuid,uuid) rename to icash_seller_reply_before_viewings;
create function icash_seller_conversation_reply(p_account uuid,p_job uuid) returns text language sql as $$select public.icash_seller_reply_before_viewings(p_account,p_job)$$;`);
await pg.exec(read('seller-call-response-recovery'));
let cases=0;
async function fixture(prompt=true){
 await q('insert into icash_accounts(id,assistant_name,owner_user_id) values($1,\'Casey\',$2)',[account,actor]);
 await q('insert into icash_customer_identities values($1,\'Example Buyer LLC\')',[account]);
 await q("insert into icash_text_threads(id,account_id,deal_id,party,recipient,sender,seller_intake_id) values($1,$2,$3,'seller','fixture-phone','fixture-sender',$4)",[thread,account,deal,lead]);
 await q("insert into icash_sms_routes(sender,recipient,account_id) values('fixture-sender','fixture-phone',$1)",[account]);
 await q("insert into icash_deal_files values($1,$2,$3,'draft','{\"address\":\"123 Example Street\"}')",[deal,account,screen]);
 await q("insert into icash_screening_jobs values($1,$2,'complete',$3,'{\"financialCheck\":{\"status\":\"eligible\"}}',now())",[screen,account,{propertyId:'property-one',sellerRequest:{id:lead}}]);
 await q("insert into icash_contact_permissions values($1,$2,$3,'seller','fixture-phone',$4,'fixture-contact')",[permission,account,screen,lead]);
 if(prompt)await q("insert into icash_text_messages(account_id,thread_id,direction,state,body,provider_id,created_at) values($1,$2,'outgoing','delivered','When is a good time to talk about a possible cash offer?','question-receipt',now()-interval '1 minute')",[account,thread]);
}
async function incomingText(body='Now',age='1 second'){
 const id=randomUUID();await q("insert into icash_text_messages(id,account_id,thread_id,direction,state,body,event_id,created_at) values($1::uuid,$2,$3,'incoming','received',$4,$1::text,now()-$5::interval)",[id,account,thread,body,age]);return id;
}
async function scenario(label,fn,prompt=true){await q('begin');try{await fixture(prompt);await fn();cases++;console.log('PASS '+label);}finally{await q('rollback');}}
const count=async()=>(await one('select count(*)::int n from icash_voice_jobs')).n;
const getJob=async()=>(await one('select * from icash_voice_jobs order by created_at desc limit 1'));
const claim=async(id)=>(await one("select icash_claim_reviewed_voice_job($1,null,null) value",[id])).value;
const queue=async(id,a=null)=>(await one('select icash_queue_seller_sms_call($1,$2,$3) value',[account,id,a])).value;
for(const body of ['Now','Right now','Now works','Yes, now','I am free now',"I'm available now",'Call me','Can you call me?','Please call me now','Call me please','Can call now ','Free now ','Available now'])await scenario(body+' queues immediately without AI',async()=>{
 const id=await incomingText(body);assert.equal(await count(),1);assert.equal((await one('select count(*)::int n from icash_text_ai_jobs')).n,0);
 const j=await getJob();assert.equal(j.sms_source_message_id,id);assert.equal(j.permission_id,permission);
 assert.equal(await queue(id),j.id);assert.equal(await count(),1);
 const result=(await one('select icash_prepare_seller_text_event($1) value',[id])).value;
 assert.equal(result.voiceJobId,j.id);assert.equal(result.accountId,account);assert.equal((await getJob()).state,'issued');
 assert.equal(await claim(j.id),true);assert.equal(await claim(j.id),false);
});
for(const body of ['Call me','Can you call me now?','Please give me a call'])await scenario('explicit request needs no earlier question: '+body,async()=>{await incomingText(body);assert.equal(await count(),1);},false);
for(const body of ['Not now','Do not call me','Call me tomorrow','Call me at 3 PM','I want a real person to call me','Call me if you pay $100000','Now I want a contract','STOP','Can call now if you pay 100000','Free now but do not call','Free tomorrow'])await scenario('no immediate call: '+body,async()=>{await incomingText(body);assert.equal(await count(),0);});
await scenario('free-floating Now cannot authorize a call',async()=>{await incomingText('Now');assert.equal(await count(),0);},false);
await scenario('reuse untouched intake call',async()=>{const first=randomUUID();await q("insert into icash_voice_jobs(id,account_id,permission_id) values($1,$2,$3)",[first,account,permission]);await incomingText();assert.equal(await count(),1);assert.equal((await getJob()).id,first);});
await scenario('provider-accepted call acknowledgement once',async()=>{
 const id=await incomingText();const j=await getJob();assert.equal((await one('select icash_seller_sms_call_ack($1,$2) value',[account,j.id])).value,null);
 await q("insert into icash_call_recordings(account_id,voice_job_id,contact_key,call_sid) values($1,$2,'fixture-contact','CAfixture')",[account,j.id]);
 const sent=(await one('select icash_seller_sms_call_ack($1,$2) value',[account,j.id])).value;assert(sent);
 assert.equal((await one('select body from icash_text_messages where id=$1',[sent])).body,'Calling you now.');
 assert.equal((await one('select icash_seller_sms_call_ack($1,$2) value',[account,j.id])).value,null);
 assert((await one('select icash_seller_conversation_message_current($1,$2) value',[account,sent])).value);
 await q('update icash_call_recordings set call_ended_at=now()');assert.equal((await one('select icash_seller_conversation_message_current($1,$2) value',[account,sent])).value,false);
});
for(const change of ["update icash_text_threads set paused=true","update icash_text_threads set ai_mode='review'","update icash_text_threads set retired_at=now()","update icash_accounts set bot_paused=true","update icash_sms_routes set needs_review=true","update fixture_policy set permitted=false","insert into icash_text_suppressions values('fixture-phone')"])
 await scenario('changed permission/route blocks dispatch: '+change,async()=>{await incomingText();const j=await getJob();await q("update icash_voice_jobs set state='issued'");await q(change);assert.equal(await claim(j.id),false);assert.equal((await one('select voice_claim_calls from fixture_policy')).voice_claim_calls,0);});
for(const body of ['Cancel my call','Tomorrow instead','STOP'])await scenario('newer reply blocks earlier immediate call: '+body,async()=>{await incomingText();const j=await getJob();await q("update icash_voice_jobs set state='issued'");await incomingText(body,'0 seconds');assert.equal(await claim(j.id),false);});
await scenario('expired Now is never called much later',async()=>{await incomingText();const j=await getJob();await q("update icash_voice_jobs set state='issued',sms_requested_at=now()-interval '6 minutes'");assert.equal(await claim(j.id),false);});
await scenario('owner-approved restart keeps original statement and audited actor',async()=>{const id=await incomingText('Call me','20 minutes');assert.equal(await count(),0);assert.equal(await queue(id,other),null);const jobId=await queue(id,actor);assert(jobId);assert.equal((await getJob()).sms_requested_by,actor);assert.equal((await one('select body from icash_text_messages where id=$1',[id])).body,'Call me');assert.equal(await queue(id,actor),jobId);});
for(const state of ['waiting','review'])await scenario('active or uncertain conversation cannot be dialed again: '+state,async()=>{await q('insert into icash_live_conversations values(\'fixture-contact\',$1)',[state]);await incomingText('Call me');assert.equal(await count(),0);});
await scenario('buyer cannot create outbound call',async()=>{await q("update icash_text_threads set party='buyer'");await incomingText('Call me');assert.equal(await count(),0);});
await scenario('verified local pre-dial rejection permits one owner restart with retained history',async()=>{const id=await incomingText('Call me');const first=await getJob();await q("update icash_voice_jobs set state='canceled',outcome='context_rejected_before_dial'");const retry=await queue(id,actor);assert(retry);assert.notEqual(retry,first.id);assert.equal(await count(),2);assert.equal(await queue(id,actor),retry);assert.equal(await count(),2);});
await scenario('anonymous cannot use queue',async()=>{await q('set local role anon');await assert.rejects(()=>queue(incoming),/permission denied/);});
for(const body of ['Now','Can call now','Free now'])await scenario('live repeated-question regression: '+body,async()=>{
 await q("update icash_text_messages set body='Are you free for a quick call now, or would later work better?'");
 await incomingText(body);assert.equal(await count(),1);assert.equal((await one('select count(*)::int n from icash_text_ai_jobs')).n,0);
});
const unavailable=async(id)=>(await one('select icash_seller_sms_call_unavailable($1,$2) value',[account,id])).value;
await scenario('known pre-dial failure explains the problem once and continues by text',async()=>{
 await incomingText();const j=await getJob();await q("update icash_voice_jobs set state='held',outcome='production_agent_review_required'");
 const id=await unavailable(j.id);assert(id);const message=await one('select body from icash_text_messages where id=$1',[id]);
 assert.equal(message.body,'I could not start the call. We can keep going by text. What repairs or updates does the property need?');
 assert.equal(await unavailable(j.id),null);assert.equal((await one('select icash_seller_conversation_message_current($1,$2) value',[account,id])).value,true);
 await q("update icash_sms_routes set needs_review=true");assert.equal((await one('select icash_seller_conversation_message_current($1,$2) value',[account,id])).value,false);
});
await scenario('failure fallback skips a previously asked condition question',async()=>{
 await q("insert into icash_text_ai_jobs(account_id,thread_id,message_id,state,analysis,outgoing_id,created_at) values($1,$2,gen_random_uuid(),'queued','{\"action\":\"ask_condition\",\"facts\":[]}',gen_random_uuid(),now()-interval '2 minutes')",[account,thread]);
 await incomingText();const j=await getJob();await q("update icash_voice_jobs set state='held',outcome='production_agent_review_required'");
 const id=await unavailable(j.id);assert.equal((await one('select body from icash_text_messages where id=$1',[id])).body,'I could not start the call. We can keep going by text. What price did you have in mind?');
});
for(const change of ["update icash_voice_jobs set state='held',outcome='provider_outcome_unknown_no_retry'","update icash_voice_jobs set state='dispatching'","update icash_voice_jobs set state='held',outcome='production_agent_review_required',operation_key='already-claimed'"])
 await scenario('uncertain/started call never claims failure: '+change,async()=>{await incomingText();const j=await getJob();await q(change);assert.equal(await unavailable(j.id),null);});
await scenario('failure notice remains account-bound',async()=>{await incomingText();const j=await getJob();await q("update icash_voice_jobs set state='held',outcome='production_agent_review_required'");assert.equal((await one('select icash_seller_sms_call_unavailable($1,$2) value',[other,j.id])).value,null);});
await pg.close();console.log(`${cases} immediate seller callback scenarios passed. Provider and billing delegates are synthetic; no real calls or texts.`);
