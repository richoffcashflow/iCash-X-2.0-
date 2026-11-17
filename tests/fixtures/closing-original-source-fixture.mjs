import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
export const closingMigration='supabase/migrations/20261116231836_closing_original_source_guard.sql';
const read=p=>readFileSync(p,'utf8');
export function sqlFunction(file,name){const source=read(file),start=source.search(new RegExp('create(?: or replace)? function public\\.'+name+'\\('));assert(start>=0,name);const tag=source.slice(start).match(/\bas (\$[a-z_]*\$)/i)[1],body=source.indexOf(tag,start);return source.slice(start,source.indexOf(tag+';',body+tag.length)+tag.length+1);}
export async function closingMetadata(db){return (await db.query(`select oid::regprocedure::text signature,md5(pg_get_functiondef(oid)) source_hash,pg_get_userbyid(proowner) owner,prosecdef,provolatile,proparallel,proconfig,proacl::text from pg_proc where oid in ('public.icash_auto_title_confirmation()'::regprocedure,'public.icash_confirm_closing_update(uuid,uuid,uuid,uuid,text,date,bigint,text)'::regprocedure) order by 1`)).rows;}
export async function installClosingSourceFixture(db){
 await db.exec(`do $$begin create role anon;exception when duplicate_object then null;end$$;do $$begin create role authenticated;exception when duplicate_object then null;end$$;do $$begin create role service_role bypassrls;exception when duplicate_object then null;end$$;
 alter role service_role bypassrls;
 create schema if not exists auth;create table auth.users(id uuid primary key);
 create table icash_accounts(id uuid primary key,owner_user_id uuid);
 create table icash_screening_jobs(id uuid primary key,account_id uuid,snapshot jsonb);
 create table icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid,stage text,terms jsonb,updated_at timestamptz default now(),seller_signed_at timestamptz default now()-interval '20 days',assignment_signed_at timestamptz,funded_at timestamptz);
 create table icash_signing_envelopes(id uuid primary key,account_id uuid,deal_id uuid,kind text,state text,test_mode boolean,terms jsonb,terms_hash text,provider_id text,provider_status text,provider_evidence jsonb,recipients jsonb,created_at timestamptz,updated_at timestamptz);
 create unique index fixture_current_agreement on icash_signing_envelopes(deal_id,kind,test_mode) where state<>'cancelled';
 create table icash_title_requests(id uuid primary key,account_id uuid,deal_id uuid,purchase_envelope_id uuid,recipient text,state text,provider_id text,rate_id uuid not null,created_at timestamptz default now()-interval '15 days',delivered_assignment_ids uuid[] default '{}');
 create table icash_title_contacts(deal_id uuid,account_id uuid,enabled boolean,verified_until timestamptz,email text);
 create table icash_title_qualification_jobs(id uuid primary key,account_id uuid,company_id uuid,state text);
 create table icash_title_directory(id uuid,public_email text);
 create table icash_operating_budget(id int primary key);insert into icash_operating_budget values(1);
 create table icash_operation_spend(operation_key text primary key,account_id uuid,rate_id uuid,dispatched_at timestamptz);
 create table icash_buyer_deposit_receipts(id uuid default gen_random_uuid(),account_id uuid,deal_id uuid,envelope_id uuid unique,terms_hash text,amount_cents bigint,method text,reference text,confirmed_by uuid,request_key uuid);
 create table icash_property_controls(account_id uuid,property_id text,manual boolean,updated_at timestamptz default now(),primary key(account_id,property_id));
 create table icash_signature_authorizations(account_id uuid,state text,envelope_id uuid);
 create table icash_text_threads(id uuid,account_id uuid,deal_id uuid,party text,paused boolean);
 create table icash_text_messages(thread_id uuid,account_id uuid,direction text,state text);
 create table icash_fulfillment_jobs(id uuid,account_id uuid,deal_id uuid,state text,updated_at timestamptz);
 create table icash_live_callbacks(account_id uuid,screening_id uuid,state text);
 create table icash_buyer_package_links(account_id uuid,deal_id uuid,revoked_at timestamptz);
 create table icash_closing_setup(account_id uuid,deal_id uuid primary key,state text,review_reason text,updated_at timestamptz);`);
 await db.exec(read('config/title-inbound.sql'));
 await db.exec(read('tests/fixtures/title-original-source-predecessor.sql'));
 await db.exec(read('config/title-tasks.sql'));
 await db.exec('alter table icash_title_tasks alter column request_id drop not null;alter table icash_title_tasks add column payload jsonb;');
 await db.exec(read('config/closing-coordination.sql'));
 await db.exec(read('config/closing-confirmations.sql'));
 const cancellation=read('supabase/migrations/20261010045243_agreement_cancellation.sql');
 await db.exec(cancellation.slice(cancellation.indexOf('create table public.icash_agreement_cancellations'),cancellation.indexOf('create function public.icash_cancellation_provider_ready')));
 await db.exec(read('tests/fixtures/closing-source-predecessors.sql'));
 for(const name of ['icash_buyer_is_reserved','icash_cancellation_provider_ready','icash_cancellation_preview','icash_request_cancellation','icash_record_cancellation_check','icash_finish_cancellation'])await db.exec(sqlFunction('supabase/migrations/20261010045243_agreement_cancellation.sql',name));
 await db.exec(sqlFunction('config/platform-shared-learning.sql','icash_learning_signature_verified'));
 await db.exec(`revoke all on function public.icash_auto_title_confirmation(),public.icash_confirm_closing_update(uuid,uuid,uuid,uuid,text,date,bigint,text),public.icash_confirm_closing_before_cancellation(uuid,uuid,uuid,uuid,text,date,bigint,text),public.icash_confirm_closing_before_disbursement(uuid,uuid,uuid,uuid,text,date,bigint,text),public.icash_buyer_is_reserved(uuid,uuid),public.icash_learning_signature_verified(public.icash_signing_envelopes) from public,anon,authenticated;
 grant execute on function public.icash_auto_title_confirmation(),public.icash_confirm_closing_update(uuid,uuid,uuid,uuid,text,date,bigint,text),public.icash_confirm_closing_before_cancellation(uuid,uuid,uuid,uuid,text,date,bigint,text),public.icash_confirm_closing_before_disbursement(uuid,uuid,uuid,uuid,text,date,bigint,text),public.icash_buyer_is_reserved(uuid,uuid),public.icash_learning_signature_verified(public.icash_signing_envelopes) to service_role;
 revoke all on function public.icash_reserve_from_closing_deposit() from public,anon,authenticated,service_role;
 create trigger buyer_reserve_closing_deposit after insert on icash_closing_updates for each row execute function icash_reserve_from_closing_deposit();`);
 await db.exec('begin;'+read('config/title-original-source.sql')+'commit;');
 // Service privileges model actual private callers; tests also execute as that role.
 await db.exec('grant usage on schema public,auth to service_role;grant all on all tables in schema public to service_role;grant select on auth.users to service_role');
}
export async function sourceCase(db,{replacement=false}={}){
 const c={owner:randomUUID(),account:randomUUID(),deal:randomUUID(),request:randomUUID(),purchase:randomUUID(),assignment:randomUUID(),rate:randomUUID(),prior:replacement?randomUUID():null};
 const terms={assignee:'Current fixture buyer',assignmentDepositCents:200000,assignmentFeeCents:1000000};
 await db.query('insert into auth.users values($1)',[c.owner]);await db.query('insert into icash_accounts values($1,$2)',[c.account,c.owner]);
 await db.query('insert into icash_screening_jobs values($1,$2,$3)',[c.deal,c.account,{propertyId:'fixture-'+c.deal}]);await db.query("insert into icash_deal_files(id,account_id,screening_id,stage,terms) values($1,$2,$1,'title_open',$3)",[c.deal,c.account,terms]);
 c.envelope=async(id,kind,state,days,agreementTerms=terms)=>{
  const recipients=[{id:'1',email:'party@example.invalid'},{id:'2',email:'owner@example.invalid'}],hash='a'.repeat(64),provider='fixture-'+id;
  const evidence={id:provider,status:'completed',test_mode:false,apply_signing_order:true,metadata:{icash_envelope:id,terms_hash:hash},recipients:recipients.map((r,i)=>({...r,status:'signed',signing_order:i+1}))};
  await db.query(`insert into icash_signing_envelopes(id,account_id,deal_id,kind,state,test_mode,terms,terms_hash,provider_id,provider_evidence,recipients,created_at,updated_at) values($1,$2,$3,$4,$5,false,$6,$7,$8,$9,$10,now()-($11::text||' days')::interval,now()-($11::text||' days')::interval+interval '1 hour')`,[id,c.account,c.deal,kind,state,agreementTerms,hash,provider,evidence,JSON.stringify(recipients),days]);
 };
 await c.envelope(c.purchase,'purchase','completed',20);
 if(c.prior)await c.envelope(c.prior,'assignment','cancelled',12,{...terms,assignee:'Previous fixture buyer'});
 await c.envelope(c.assignment,'assignment','completed',replacement?1:5);
 await db.query('update icash_deal_files set seller_signed_at=(select created_at+interval \'1 hour\' from icash_signing_envelopes where id=$2),assignment_signed_at=(select created_at+interval \'1 hour\' from icash_signing_envelopes where id=$3) where id=$1',[c.deal,c.purchase,c.assignment]);
 if(replacement)await db.query(`insert into icash_agreement_cancellations(account_id,deal_id,actor_user_id,request_key,kind,state,reason,previous_stage,snapshot,completed_at) values($1,$2,$3,$4,'assignment','completed','Fixture completed release','title_open',$5,now()-interval '2 days')`,[c.account,c.deal,c.owner,randomUUID(),JSON.stringify([{id:c.prior}])]);
 await db.query("insert into icash_title_requests(id,account_id,deal_id,purchase_envelope_id,recipient,state,provider_id,delivered_assignment_ids,rate_id) values($1,$2,$3,$4,'closer@example.invalid','sent','original-email',array[$5::uuid],$6)",[c.request,c.account,c.deal,c.purchase,c.assignment,c.rate]);
 await db.query("insert into icash_operation_spend values($1,$2,$3,now()-interval '14 days')",['title:'+c.request,c.account,c.rate]);
 await db.query("insert into icash_title_contacts values($1,$2,true,now()+interval '1 day','closer@example.invalid')",[c.deal,c.account]);
 const original=randomUUID();await db.query("insert into icash_title_replies(id,provider_email_id,account_id,deal_id,request_id,sender,subject,body_text,sender_verified,received_at) values($1,$2,$3,$4,$5,'closer@example.invalid','Fixture','Original historical milestones',true,now()-interval '10 days')",[original,randomUUID(),c.account,c.deal,c.request]);
 await db.query("insert into icash_closing_updates(account_id,deal_id,reply_id,kind,amount_cents,confirmed_by,created_at) values($1,$2,$3,'title_opened',null,$4,now()-interval '10 days'),($1,$2,$3,'deposit_received',200000,$4,now()-interval '2 days')",[c.account,c.deal,original,c.owner]);
 await db.query("insert into icash_buyer_deposit_receipts(account_id,deal_id,envelope_id,terms_hash,amount_cents,method,reference,confirmed_by,request_key) values($1,$2,$3,$4,200000,'check','Fixture exact cleared deposit',$5,$6) on conflict(envelope_id) do nothing",[c.account,c.deal,c.assignment,'a'.repeat(64),c.owner,randomUUID()]);
 c.date=async(days=0)=>(await db.query("select ((now() at time zone 'America/Chicago')::date-$1::int)::text d",[days])).rows[0].d;
 c.sourceTime=async(days=0)=>new Date((await db.query("select clock_timestamp()-($1::text||' days')::interval-interval '2 seconds' t",[days])).rows[0].t).toISOString();
 c.state=async()=>({deal:(await db.query('select stage,terms from icash_deal_files where id=$1',[c.deal])).rows[0],updates:(await db.query('select * from icash_closing_updates where deal_id=$1 order by created_at,id',[c.deal])).rows,tasks:(await db.query("select * from icash_title_tasks where deal_id=$1 and source_key like 'closing-source:%' order by source_key",[c.deal])).rows});
 return c;
}
export function confirmation({kind='closed',date,amount='none',agreement=null,file='FIXTURE-CURRENT'}){return `ICASH CONFIRMATION\nStatus: ${kind}\nDate: ${date??'none'}\nAmount cents: ${amount}\nFile: ${file}${agreement?`\nAgreement: ${agreement}`:''}\nEND ICASH CONFIRMATION`;}
export async function recordConfirmation(db,c,body,{source={},legacy=false,email=randomUUID(),authenticated=true,sender='closer@example.invalid'}={}){
 const metadata={providerReceivedAt:await c.sourceTime(),webhookEventId:'fixture-'+randomUUID(),bodyComplete:true,bodySha256:createHash('sha256').update(body).digest('hex'),...source};
 const args=[email,'T',c.request,sender,'Fixture source',body,authenticated];
 await db.query(legacy?'select icash_record_title_reply($1,$2,$3,$4,$5,$6,$7)':'select icash_record_title_reply_source($1,$2,$3,$4,$5,$6,$7,$8)',legacy?args:[...args,metadata]);
 return (await db.query('select * from icash_title_replies where provider_email_id=$1',[email])).rows[0];
}
export async function requestCancellation(db,c){const revision=(await db.query('select icash_cancellation_preview($1,$2,$3) x',[c.account,c.owner,c.deal])).rows[0].x.revision;return (await db.query("select icash_request_cancellation($1,$2,$3,'assignment','Fixture cancellation',$4,$5) id",[c.account,c.owner,c.deal,randomUUID(),revision])).rows[0].id;}
export async function runClosingSourceFixture(db,{beforeMigration}={}){
 await installClosingSourceFixture(db);
 const before=await closingMetadata(db);assert.deepEqual(before.map(x=>x.source_hash),['c047ed3e8eca8091be628e6de5bf7508','2e15ff5ca09613f4db076c26d6a576ae']);
 const broken=await sourceCase(db,{replacement:true});const oldBody=confirmation({date:await broken.date(7)});
 const oldReply=await recordConfirmation(db,broken,oldBody,{source:{providerReceivedAt:await broken.sourceTime(7)}});
 assert.equal((await broken.state()).deal.stage,'closed','Reproduced: delayed old-buyer email closes the replacement despite original time/date before its creation');
 const historical=(await broken.state()).updates,oldClosing=historical.find(x=>x.kind==='closed');assert.equal(oldClosing.confirmation_source,'verified_title_format');
 const migration=read(closingMigration);assert.equal(migration,read('config/closing-original-source-guard.sql'));
 await db.exec('grant execute on function public.icash_auto_title_confirmation() to authenticated');
 await assert.rejects(db.exec('begin;'+migration+'commit;'),/metadata changed/);await db.exec('rollback');
 assert.equal((await db.query("select to_regnamespace('icash_closing_source_private') x")).rows[0].x,null);
 await db.exec('revoke execute on function public.icash_auto_title_confirmation() from authenticated');
 const originalAuto=(await db.query("select pg_get_functiondef('icash_auto_title_confirmation()'::regprocedure) definition")).rows[0].definition;
 await db.exec("create or replace function public.icash_auto_title_confirmation() returns trigger language plpgsql set search_path='' as $$begin return new;end$$");
 await assert.rejects(db.exec('begin;'+migration+'commit;'),/predecessor changed/);await db.exec('rollback');await db.exec(originalAuto);
 assert.equal((await db.query("select to_regnamespace('icash_closing_source_private') x")).rows[0].x,null);
 if(beforeMigration)await beforeMigration(migration,before);
 await db.exec('begin;'+migration+'commit;');
 const after=await closingMetadata(db);assert.deepEqual(after.map((x,i)=>({...x,source_hash:before[i].source_hash})),before,'Full wrapper metadata is preserved');
 await assert.rejects(db.exec('begin;'+migration+'commit;'),/predecessor changed/);await db.exec('rollback');assert.deepEqual(await closingMetadata(db),after,'Installing twice fails without changing the installed source');
 assert.deepEqual((await broken.state()).updates,historical.map(x=>({...x,agreement_envelope_id:null})),'No historical milestone is rewritten/rebound');
 const repeated=(await db.query("select icash_confirm_closing_update($1,$2,$3,$4,'closed',$5,null,'FIXTURE-CURRENT') id",[broken.account,broken.owner,broken.deal,oldReply.id,oldClosing.effective_date])).rows[0].id;assert.equal(repeated,oldClosing.id,'Historical exact replay observes its old ID without new authority');
 const cases=[
  {name:'late old-buyer source',replacement:true,days:7,sourceDays:7},
  {name:'fresh ingestion cannot replace old source time',replacement:true,sourceDays:7,explicit:true},
  {name:'effective date predates current agreement',replacement:true,days:7,explicit:true},
  {name:'replacement needs explicit agreement',replacement:true},
  {name:'wrong agreement',replacement:true,agreement:broken.assignment},
  {name:'missing original time',source:{providerReceivedAt:null}},
  {name:'invalid original time',source:{providerReceivedAt:'bad'}},
  {name:'future original time',source:{providerReceivedAt:'2099-01-01T00:00:00Z'}},
  {name:'incomplete body',source:{bodyComplete:false}},
  {name:'different body hash',source:{bodySha256:'0'.repeat(64)}},
  {name:'legacy recorder is review only',legacy:true},
  {name:'uncertain original title delivery',requestState:'needs_review'},
  {name:'empty original title provider receipt',mutate:async c=>db.query("update icash_title_requests set provider_id=' ' where id=$1",[c.request])},
  {name:'missing original title dispatch',mutate:async c=>db.query('update icash_operation_spend set dispatched_at=null where operation_key=$1',['title:'+c.request])},
  {name:'source before actual title dispatch',mutate:async c=>db.query("update icash_operation_spend set dispatched_at=now()-interval '1 second' where operation_key=$1",['title:'+c.request])},
  {name:'wrong original title rate',mutate:async c=>db.query('update icash_operation_spend set rate_id=$2 where operation_key=$1',['title:'+c.request,randomUUID()])},
  {name:'missing purchase signature observation',mutate:async c=>db.query('update icash_deal_files set seller_signed_at=null where id=$1',[c.deal])},
  {name:'missing assignment signature observation',mutate:async c=>db.query('update icash_deal_files set assignment_signed_at=null where id=$1',[c.deal])},
  {name:'source between draft and verified signature',sourceDays:3,mutate:async c=>db.query("update icash_deal_files set assignment_signed_at=now()-interval '2 days' where id=$1",[c.deal])},
  {name:'effective event between draft and verified signature',days:3,mutate:async c=>db.query("update icash_deal_files set assignment_signed_at=now()-interval '2 days' where id=$1",[c.deal])},
  {name:'replacement observation before current draft',replacement:true,explicit:true,mutate:async c=>db.query("update icash_deal_files set assignment_signed_at=now()-interval '3 days' where id=$1",[c.deal])},
  {name:'late cancelled agreement activity',replacement:true,explicit:true,mutate:async c=>db.query('update icash_agreement_cancellations set late_activity=true where deal_id=$1',[c.deal])},
 ];
 for(const item of cases){const c=await sourceCase(db,{replacement:item.replacement}),body=confirmation({date:await c.date(item.days??0),agreement:item.agreement??(item.explicit?c.assignment:null)});if(item.requestState)await db.query('update icash_title_requests set state=$2 where id=$1',[c.request,item.requestState]);if(item.mutate)await item.mutate(c);
  const reply=await recordConfirmation(db,c,body,{legacy:item.legacy,source:{...item.source,...(item.sourceDays?{providerReceivedAt:await c.sourceTime(item.sourceDays)}:{})}}),state=await c.state();
  assert.equal(state.deal.stage,'title_open',item.name);assert(!state.updates.some(x=>x.kind==='closed'),item.name);assert(state.tasks.some(x=>x.reply_id===reply.id&&x.state==='needs_review'),item.name+' retains a targeted review');
 }
 for(const mutate of [b=>b.replace('\nEND','\nAgreement: '+randomUUID()+'\nEND'),b=>b.replace(/Agreement: [^\n]+/,'Agreement: invalid'),b=>'> '+b,b=>b+'\nActually, do not close.',b=>b.replace('\nAgreement:', '\n> Agreement:')]){
  const c=await sourceCase(db,{replacement:true}),body=mutate(confirmation({date:await c.date(),agreement:c.assignment}));await recordConfirmation(db,c,body);assert.equal((await c.state()).deal.stage,'title_open','Malformed, duplicate, quoted and mixed confirmation cannot close');
 }
 for(const replacement of [false,true]){const c=await sourceCase(db,{replacement}),body=confirmation({date:await c.date(),agreement:replacement?c.assignment:null});await db.exec('set role service_role');const reply=await recordConfirmation(db,c,body);await db.exec('reset role');let state=await c.state();assert.equal(state.deal.stage,'closed','Valid current '+(replacement?'explicit replacement':'original legacy format')+' completes');assert.equal(state.updates.find(x=>x.kind==='closed').agreement_envelope_id,c.assignment);assert.equal(state.tasks.length,0);
  await recordConfirmation(db,c,confirmation({kind:'funds_disbursed',date:await c.date(),amount:'1000000',agreement:replacement?c.assignment:null}));state=await c.state();assert.equal(state.updates.filter(x=>x.kind==='funds_disbursed').length,1,'Current bound closing supports later distinct disbursement, not owner bank receipt');
  await recordConfirmation(db,c,body,{email:reply.provider_email_id});assert.equal((await c.state()).updates.filter(x=>x.kind==='closed').length,1,'Provider duplicate stays one original milestone');
 }
 const manual=await sourceCase(db),reply=await recordConfirmation(db,manual,'Owner reviews this ordinary original reply',{legacy:true});await db.query("select icash_confirm_closing_update($1,$2,$3,$4,'closed',$5,null,'MANUAL-REVIEW')",[manual.account,manual.owner,manual.deal,reply.id,await manual.date()]);assert.equal((await manual.state()).deal.stage,'closed','Explicit review of a legacy original single agreement remains supported');
 const other=await sourceCase(db),otherReply=await recordConfirmation(db,other,'Ordinary review');await assert.rejects(db.query("select icash_confirm_closing_update($1,$2,$3,$4,'closed',$5,null,'CROSS')",[manual.account,manual.owner,other.deal,otherReply.id,await other.date()]));
 for(const role of ['anon','authenticated'])for(const signature of ['icash_closing_source_private.check_confirmation(uuid,uuid,uuid,text,date,uuid,boolean)','public.icash_confirm_closing_update(uuid,uuid,uuid,uuid,text,date,bigint,text)'])assert.equal((await db.query('select has_function_privilege($1,$2,\'execute\') ok',[role,signature])).rows[0].ok,false);
 console.log('PASS closing source: reproduced delayed old-buyer closure; actual recorder preserves original evidence and holds stale, incomplete, unbound, malformed and uncertain-delivery confirmations; valid current originals/replacements, private ACLs and historical idempotency retained.');
 return {before,after};
}
