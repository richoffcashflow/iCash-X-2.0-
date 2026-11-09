// Synthetic local PostgreSQL only. No provider requests or production data.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const account=id(1),other=id(2),notice='Free Msg: Receiver 12025550123 unable to receive message - Message Blocking is active';
const at=n=>new Date(Date.UTC(2026,10,1,0,n)).toISOString();
const definition=(file,start)=>{const text=read(file),i=text.indexOf(start);assert(i>=0,start);return text.slice(i,text.indexOf('$$;',i)+3);};
const pg=await PGlite.create(),q=(sql,p=[])=>pg.query(sql,p),rows=async(sql,p=[]) =>(await q(sql,p)).rows,scalar=async(sql,p=[])=>Object.values((await rows(sql,p))[0])[0];
const lead=n=>id(n+1000),screen=n=>id(n+2000),deal=n=>id(n+3000),thread=n=>id(n+4000),message=n=>id(n+5000);
try{
 await pg.exec(read('tests/fixtures/carrier-notice-projection-schema.sql'));
 await pg.exec(`alter table icash_meta_leads add column lead_id uuid primary key,add column response_channel text,add column paused boolean default false,add column voice_paused boolean default false,add column declined_at timestamptz,add column address_confirmed_at timestamptz,add column address_channel text,add column first_outreach_at timestamptz,add column submitted_at timestamptz default now(),add column form_id text,add column campaign_id text,add column created_at timestamptz default now(),add column consent_receipt jsonb default '{"fixture":"preserve"}',add column next_attempt_at timestamptz default now();
 alter table icash_text_threads add column seller_intake_id uuid;
 alter table icash_live_conversations add column contact_key text;
 create table icash_seller_intakes(id uuid primary key,name text,phone text,address text,state text default 'awaiting_address',hold_reason text);
 create table icash_text_message_reads(account_id uuid,message_id uuid);
 create table fixture_suppressions(account_id uuid,phone text,reason text);
 insert into fixture_suppressions values('${account}','+12025550123','STOP');
 insert into icash_accounts values('${account}',null),('${other}',null);`);
 const foundation=read('config/carrier-text-notice-classification.sql');
 await pg.exec(foundation.slice(foundation.indexOf('create function public.icash_is_carrier_text_notice'),foundation.indexOf('create view public.icash_response_text_attention')));
 await pg.exec(definition('config/homeoffer-meta-events.sql','create or replace function public.icash_seller_human_answer'));
 await pg.exec(definition('config/meta-live-address-continuation.sql','create or replace function public.icash_meta_call_outcome'));
 await pg.exec(definition('config/meta-live-address-continuation.sql','create or replace function public.icash_meta_observe_call'));
 // Existing reply projection, already filtered by the preceding migration.
 await pg.exec(definition('config/seller-reply-visibility.sql','create function public.icash_workspace_seller_texts').replaceAll('public.icash_text_messages','public.icash_response_text_messages'));
 await pg.exec(read('tests/fixtures/carrier-notice-meta-projections-before.sql'));
 const signatures=['icash_meta_workspace_response_leads(uuid,text,integer,integer,uuid,boolean)','icash_meta_workspace_leads(uuid,text,integer,integer,uuid)','icash_workspace_response_counts(uuid)'];
 for(const signature of signatures)await pg.exec(`revoke all on function ${signature} from public,anon,authenticated;grant execute on function ${signature} to service_role;`);
 async function add(n,{a=account,body=notice,channel='sms',response=at(30),msgAt=at(30),attachments=[],messageAccount=a,threadAccount=a,threadLead=lead(n),threadDeal=deal(n),messageState='received',direction='incoming',retired=false}={}){
  await q(`insert into icash_seller_intakes(id,name,phone) values($1,$2,'+12025550123')`,[lead(n),'Fixture '+n]);
  await q(`insert into icash_screening_jobs(id,account_id,state,result) values($1,$2,'awaiting_address',$3)`,[screen(n),a,{property:{address:n+' Fixture Street',propertyId:'prop_'+n}}]);
  await q(`insert into icash_deal_files(id,account_id,screening_id) values($1,$2,$3)`,[deal(n),a,screen(n)]);
  await q(`insert into icash_text_threads(id,account_id,deal_id,party,seller_intake_id,recipient,retired_at) values($1,$2,$3,'seller',$4,'+12025550123',$5)`,[thread(n),threadAccount,threadDeal,threadLead,retired?at(40):null]);
  await q(`insert into icash_meta_leads(lead_id,account_id,screening_id,response_at,response_channel,created_at,first_outreach_at) values($1,$2,$3,$4,$5,$6,$7)`,[lead(n),a,screen(n),response,channel,at(n),at(1)]);
  if(body!==null)await q(`insert into icash_text_messages(id,account_id,thread_id,direction,state,body,attachments,provider_id,created_at) values($1,$2,$3,$4,$5,$6,$7,'fixture-provider',$8)`,[message(n),messageAccount,thread(n),direction,messageState,body,attachments,msgAt]);
 }
 async function human(n,t,body='Yes, please tell me more',attachments=[],a=account){await q(`insert into icash_text_messages(id,account_id,thread_id,direction,state,body,attachments,created_at) values($1,$2,$3,'incoming','received',$4,$5,$6)`,[id(10000+n*100+t),a,thread(n),body,attachments,at(t)]);}
 for(let n=10;n<=35;n++)await add(n,
  n===14?{body:null}:n===15?{response:at(29)}:n===16?{channel:null}:n===17?{channel:'call'}:n===18?{channel:'form'}:
  n===19?{attachments:[{url:'https://example.invalid/attachment'}]}:n===20?{body:'I received this: '+notice}:n===21?{body:'Free Msg: Message blocked'}:
  n===22?{messageAccount:other}:n===23?{threadAccount:other}:n===24?{threadLead:lead(10)}:n===25?{threadDeal:deal(10)}:
  n===26?{messageState:'ready'}:n===27?{direction:'outgoing'}:n===28?{retired:true}:n===29?{response:null}:n===30?{a:other}:{});
 await human(11,20);await human(11,50);await human(12,45);await human(13,30,'Actual simultaneous human reply');
 await human(28,15,'Earlier reply on a now retired thread');
 await human(31,40,notice,[{url:'https://example.invalid/real-attachment'}]);
 await human(32,40,'Quoted notice: '+notice);
 await human(10,40,'Foreign human reply',[],other);
 await q(`update icash_meta_leads set paused=true,voice_paused=true,declined_at=$1 where lead_id=$2`,[at(31),lead(10)]);
 await q(`update icash_meta_leads set address_confirmed_at=$1,address_channel='form' where lead_id=$2`,[at(35),lead(33)]);
 const voice={transcript:[{role:'user',message:'Yes, I would like to sell the house.'}],interested:true};
 await q(`insert into icash_live_conversations(id,account_id,screening_id,party,state,result,contact_key,completed_at,conversation_id) values($1,$2,$3,'seller','complete',$4,encode(sha256(convert_to('+12025550123','UTF8')),'hex'),$5,'voice-fixture')`,[id(20001),account,screen(34),voice,at(25)]);
 await q(`insert into icash_seller_email_openers values($1,$2,$3,'seller@example.invalid')`,[account,deal(35),id(20002)]);
 await q(`insert into icash_deal_emails(id,account_id,deal_id,reply_to_id,direction,state,provider_id,recipient,created_at) values($1,$2,$3,$4,'incoming','received','email-fixture','seller@example.invalid',$5)`,[id(20003),account,deal(35),id(20002),at(38)]);
 // Non-human/mismatched voice and email sources cannot manufacture a reply.
 await q(`insert into icash_live_conversations(id,account_id,screening_id,party,state,result,contact_key,completed_at) values($1,$2,$3,'seller','complete',$4,'wrong-contact',$5),($6,$2,$3,'seller','complete',$7,encode(sha256(convert_to('+12025550123','UTF8')),'hex'),$5)`,[id(20004),account,screen(10),voice,at(40),id(20005),{transcript:[{role:'user',message:'Please leave a message after the beep.'}]}]);
 await q(`insert into icash_deal_emails(id,account_id,deal_id,reply_to_id,direction,state,provider_id,recipient,created_at) values($1,$2,$3,$4,'incoming','received','foreign-email','seller@example.invalid',$5)`,[id(20006),other,deal(10),id(20002),at(45)]);
 await q(`insert into icash_operation_spend values($1,$2,null,'held',null),($1,$3,now(),'settled',123)`,[account,'text:'+message(10),'text:'+message(11)]);
 await q(`insert into icash_opportunity_outcomes(screening_id,account_id,purchase_signed,interested,opted_out) values($1,$2,true,true,false)`,[screen(29),account]);
 const tables=['icash_meta_leads','icash_seller_intakes','icash_text_messages','icash_text_threads','icash_live_conversations','icash_deal_emails','icash_operation_spend','fixture_suppressions','icash_opportunity_outcomes'];
 const snapshot=async()=>Object.fromEntries(await Promise.all(tables.map(async table=>[table,await rows(`select row_to_json(t) value from ${table} t order by row_to_json(t)::text`)])));
 const before=await snapshot();
 const beforeCall=await scalar("select pg_get_functiondef('icash_meta_observe_call()'::regprocedure)");
 const originalDisplays=Object.fromEntries(await Promise.all(signatures.map(async signature=>[signature,await scalar('select pg_get_functiondef($1::regprocedure)',[signature])])));
 const rawGates=()=>rows('select lead_id,response_at is null and address_confirmed_at is null and declined_at is null and not paused as unanswered_eligible from icash_meta_leads order by lead_id');
 const gatesBefore=await rawGates();
 const beforeCounts=await scalar('select icash_workspace_response_counts($1)',[account]);
 const migration=read('config/carrier-text-notice-meta-projections.sql');
 assert.equal(migration,read('supabase/migrations/20261109000500_carrier_text_notice_meta_projections.sql'));
 await pg.exec(migration);
 const display=async(n,a=account)=>{const value=await scalar('select icash_meta_display_response_at($1,$2)',[a,lead(n)]);return value===null?null:new Date(value).toISOString();};
 assert.equal(await display(10),null,'Only exact notice source is excluded; foreign/mismatched sources do not supply a response');
 for(const [n,t] of [[11,20],[12,45],[13,30],[28,15],[31,40],[32,40],[33,35],[34,25],[35,38]])assert.equal(await display(n),at(t),'Preserve independent first response for '+n);
 for(const n of [14,16,17,18,19,20,21,22,23,24,25,26,27])assert.equal(await display(n),at(30),'Preserve unknown/non-notice/mismatched source '+n);
 assert.equal(await display(15),at(29),'A later notice cannot reinterpret an earlier unknown response');
 assert.equal(await display(29),null,'Never create a response where raw response_at was absent');
 assert.equal(await display(30),null,'No cross-account lead reads');assert.equal(await display(999),null);
 assert.equal(await display(30,other),null,'Own exact notice projects away for each account independently');
 const general=await scalar("select icash_meta_workspace_leads($1,'',0,25,$2)",[account,screen(10)]);
 assert.equal(general[0].responseAt,null);assert.equal(general[0].paused,true);assert.equal(general[0].declinedAt,new Date(at(31)).toISOString().replace('.000Z','+00:00'));
 assert.equal((await scalar("select icash_meta_workspace_response_leads($1,'',0,25,$2,true)",[account,screen(10)])).length,0);
 const responses=await scalar("select icash_meta_workspace_response_leads($1,'',0,25,null,true)",[account]);
 const times=responses.map(r=>Date.parse(r.responseAt));assert.deepEqual(times,[...times].sort((a,b)=>b-a),'Corrected response times order before pagination');
 assert.equal(responses[0].leadId,lead(12),'A later real reply sorts above the historical carrier time');
 const page1=await scalar("select icash_meta_workspace_response_leads($1,'',0,4,null,true)",[account]),page2=await scalar("select icash_meta_workspace_response_leads($1,'',4,4,null,true)",[account]);
 assert.deepEqual([...page1,...page2].map(r=>r.leadId),responses.slice(0,8).map(r=>r.leadId));assert.equal(new Set([...page1,...page2].map(r=>r.leadId)).size,8);
 const counts=await scalar('select icash_workspace_response_counts($1)',[account]);
 assert.equal(counts.total,beforeCounts.total);assert.equal(counts.responded,beforeCounts.responded-1,'Only notice-only Meta response removed; signed purchase remains counted');
 assert.deepEqual(await snapshot(),before,'No raw source, customer controls, accepted messages, suppressions, outcome facts or unknown costs changed');
 assert.deepEqual(await rawGates(),gatesBefore,'Removing display response never reopens raw unanswered follow-up admission');
 assert.equal(await scalar("select pg_get_functiondef('icash_meta_observe_call()'::regprocedure)"),beforeCall,'Actual call writer untouched');
 for(const signature of signatures){
  const after=await scalar('select pg_get_functiondef($1::regprocedure)',[signature]);
  assert.equal(after,originalDisplays[signature].replaceAll('m.response_at','public.icash_meta_display_response_at(m.account_id,m.lead_id)'),'Only response projection changes in '+signature);
 }
 for(const signature of [...signatures,'icash_meta_display_response_at(uuid,uuid)']){
  for(const role of ['anon','authenticated'])assert.equal(await scalar("select has_function_privilege($1,$2,'execute')",[role,signature]),false);
  assert.equal(await scalar("select has_function_privilege('service_role',$1,'execute')",[signature]),true);
  assert.equal(await scalar('select prosecdef from pg_proc where oid=$1::regprocedure',[signature]),false);
 }
 // A later real message is immediately visible with no historical table rewrite.
 await human(10,55);assert.equal(await display(10),at(55));
 assert.equal(await scalar('select response_at is not null and paused and voice_paused and declined_at is not null from icash_meta_leads where lead_id=$1',[lead(10)]),true);
 assert.deepEqual(await rawGates(),gatesBefore);
 // A changed last predecessor aborts atomically, including earlier display patches.
 for(const signature of signatures)await pg.exec(originalDisplays[signature]);
 await pg.exec('drop function icash_meta_display_response_at(uuid,uuid)');
 await pg.exec(originalDisplays[signatures[2]].replace('m.response_at','coalesce(m.response_at,m.response_at)'));
 await assert.rejects(pg.exec(migration),/Carrier Meta response display prerequisite changed/);await pg.exec('rollback');
 for(const signature of signatures.slice(0,2))assert.equal(await scalar('select pg_get_functiondef($1::regprocedure)',[signature]),originalDisplays[signature]);
 assert.equal(await scalar("select to_regprocedure('icash_meta_display_response_at(uuid,uuid)')"),null,'Failed migration rolls helper and earlier patches back');
 assert.deepEqual(await rawGates(),gatesBefore);
 console.log('PASS carrier Meta response projections: exact legacy notice binding, unknown/source preservation, independent SMS/call/address/email evidence, pre-page ordering/counts, late reply, ACLs and unchanged raw no-response controls.');
}finally{await pg.close();}
