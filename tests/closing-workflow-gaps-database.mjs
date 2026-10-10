// Real local Postgres transactions; all provider/billing boundaries are fixture-only.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href),db=await PGlite.create();
const q=(sql,args=[])=>db.query(sql,args),one=async(sql,args=[])=>(await q(sql,args)).rows[0];
const account=randomUUID(),actor=randomUUID(),other=randomUUID(),deal=randomUUID(),purchase=randomUUID(),rate=randomUUID(),request=randomUUID();
try{
 await db.exec(`
 create role anon;create role authenticated;create role service_role;
 create table icash_accounts(id uuid primary key,owner_user_id uuid,bot_paused boolean default false);
 create table icash_operating_budget(id int primary key,enabled boolean default true);insert into icash_operating_budget values(1,true);
 create table icash_screening_jobs(id uuid primary key,account_id uuid,snapshot jsonb);
 create table icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid,stage text,terms jsonb default '{}');
 create table icash_signing_envelopes(id uuid primary key,account_id uuid,deal_id uuid,kind text,state text,test_mode boolean default false,terms jsonb default '{}');
 create table icash_agreement_cancellations(deal_id uuid,late_activity boolean);
 create table icash_operation_rates(id uuid primary key,operation text,enabled boolean,expires_at timestamptz);
 create table icash_operation_spend(operation_key text primary key,account_id uuid,rate_id uuid,claimed boolean default false);
 create table icash_property_controls(account_id uuid,property_id text,manual boolean);
 create table icash_title_replies(id uuid primary key default gen_random_uuid(),account_id uuid,deal_id uuid,request_id uuid,sender_verified boolean,body_text text,needs_review boolean default true);
 create table icash_buyer_viewing_requests(id uuid primary key default gen_random_uuid(),account_id uuid,deal_id uuid,screening_id uuid,kind text default 'viewing',quote text default 'View the property',viewing_quote text,coordination_quote text,state text default 'needs_confirmation',reviewed_at timestamptz,created_at timestamptz default now());
 create table icash_closing_setup(id uuid primary key default gen_random_uuid(),account_id uuid,deal_id uuid unique,payout jsonb,updated_at timestamptz default now());
 create table icash_showing_requests(id uuid primary key default gen_random_uuid(),deal_id uuid,buyer_name text not null,starts_at timestamptz not null,ends_at timestamptz not null,timezone text not null,state text default 'proposed' check(state in ('proposed','confirmed','cancelled','completed')),seller_confirmed_at timestamptz,buyer_confirmed_at timestamptz,created_at timestamptz default now(),check(ends_at>starts_at and ends_at<=starts_at+interval '4 hours'),check(state<>'confirmed' or(seller_confirmed_at is not null and buyer_confirmed_at is not null)));
 create table icash_automation_tickets(id uuid primary key default gen_random_uuid(),token text default gen_random_uuid()::text,account_id uuid,kind text constraint icash_automation_tickets_kind_check check(kind in ('fulfillment')),screening_id uuid,state text default 'issued',expires_at timestamptz default now()+interval '10 minutes',created_at timestamptz default now(),live_call_id uuid,signing_id uuid,voice_job_id uuid,fulfillment_job_id uuid);
 create function icash_next_automation() returns jsonb language sql as $$select null::jsonb$$;
 create function icash_propose_showing(uuid,uuid,text,timestamptz,timestamptz,text) returns uuid language sql as $$select gen_random_uuid()$$;
 create function icash_reserve_operation(a uuid,k text,r uuid,u timestamptz) returns void language plpgsql set search_path=public as $$begin insert into icash_operation_spend(operation_key,account_id,rate_id) values(k,a,r) on conflict do nothing;end$$;
 create function icash_claim_operation(k text) returns boolean language plpgsql set search_path=public as $$begin update icash_operation_spend set claimed=true where operation_key=k and not claimed;return found;end$$;
 create function icash_signing_action_allowed(a uuid,eid uuid) returns boolean language sql set search_path=public as $$select exists(select 1 from icash_signing_envelopes e join icash_deal_files d on d.id=e.deal_id and d.account_id=e.account_id where e.id=eid and e.account_id=a and e.state not in ('cancellation_pending','cancelled') and d.stage not in ('cancellation_pending','cancelled','closed') and not exists(select 1 from icash_agreement_cancellations c where c.deal_id=d.id and c.late_activity))$$;
 `);
 for(const file of ['title-requests','title-tasks','title-followup'])await db.exec(readFileSync(`config/${file}.sql`,'utf8'));
 // The production closer-match policy, with a verified post-signing contact allowed.
 const setup=readFileSync('config/closing-setup.sql','utf8');await db.exec(setup.slice(setup.indexOf('create function public.icash_title_contact_matches'),setup.indexOf('create function public.icash_seed_closing_setup')));
 await db.exec(`do $$ declare def text;begin def:=pg_get_functiondef('icash_prepare_title_request(uuid,uuid)'::regprocedure);execute replace(def,'lower(c.email) is distinct from lower(d.terms->>''titleEmail'')','not public.icash_title_contact_matches(p_account,p_deal,c.email)');end$$;`);
 await db.exec(readFileSync('supabase/migrations/20261010084029_closing_workflow_gaps.sql','utf8'));
 await q('insert into icash_accounts values($1,$2,false)',[account,actor]);
 await q(`insert into icash_screening_jobs values($1,$2,'{"propertyId":"fixture"}')`,[deal,account]);
 await q(`insert into icash_deal_files values($1,$2,$1,'under_contract','{"titleEmail":"","address":"100 Fixture Lane"}')`,[deal,account]);
 await q(`insert into icash_signing_envelopes values($1,$2,$3,'purchase','completed',false,'{"closingDate":"2026-12-22","inspectionDays":7,"effectiveDate":""}')`,[purchase,account,deal]);
 await q(`insert into icash_operation_rates values($1,'title_email',true,now()+interval '30 days')`,[rate]);
 await q(`insert into icash_title_contacts values($1,$2,'closer@example.invalid',now()+interval '30 days','owner-closing-verification:fixture',$3,true)`,[deal,account,rate]);
 await q(`insert into icash_buyer_viewing_requests(id,account_id,deal_id,screening_id) values($1,$2,$3,$3)`,[request,account,deal]);
 let count=0;const pass=label=>console.log(`PASS ${++count}/8 ${label}`);
 const acknowledge=(action,note='',a=account,u=actor)=>q('select icash_update_buyer_request($1,$2,$3,$4,$5)',[a,u,request,action,note]);
 await acknowledge('acknowledge');let r=await one('select * from icash_buyer_viewing_requests where id=$1',[request]);assert.equal(r.state,'needs_confirmation');assert(r.acknowledged_at);
 await assert.rejects(acknowledge('resolve',''));await assert.rejects(acknowledge('acknowledge','',account,other));
 await acknowledge('resolve','Buyer asked us to follow up next week');assert.equal((await one('select state from icash_buyer_viewing_requests where id=$1',[request])).state,'reviewed');
 await q(`update icash_buyer_viewing_requests set state='needs_confirmation' where id=$1`,[request]);pass('Acknowledgment retains follow-up; resolution requires an owner outcome');

 const deadlines=(await q(`select * from icash_title_tasks where kind='deadline' order by source_key`)).rows;
 assert.equal((await q('select * from icash_closing_task_attention($1,0,7)',[account])).rows.length,2);assert.equal((await q('select * from icash_closing_task_attention($1,0,7)',[other])).rows.length,0);assert.equal(deadlines.length,2);assert(deadlines.every(t=>t.state==='needs_review'&&t.request_id===null));assert.equal(deadlines.find(t=>t.payload.deadline==='inspection').due_date,null);
 await q('select icash_seed_contract_deadlines($1)',[purchase]);assert.equal((await one(`select count(*)::int n from icash_title_tasks`)).n,2);
 await q(`select icash_update_title_task($1,$2,'confirm','2026-12-20')`,[account,deadlines[0].id]);assert.equal((await one('select state from icash_title_tasks where id=$1',[deadlines[0].id])).state,'scheduled');pass('Signed snapshots create reviewable deadlines without inventing an effective date');

 const payout={payeeName:'Fixture LLC',payeeType:'company',method:'check_pickup',mailingAddress:'',detailsSharedWithTitle:false};
 await q('insert into icash_closing_setup(account_id,deal_id,payout) values($1,$2,$3)',[account,deal,payout]);
 const title=(await one('select icash_prepare_title_request($1,$2) job',[account,deal])).job;
 const delivered={...payout};delete delivered.detailsSharedWithTitle;
 await q(`update icash_title_requests set state='sent',delivered_payout=$2 where id=$1`,[title.id,delivered]);
 assert.equal((await one(`select count(*)::int n from icash_title_tasks where kind='document_update'`)).n,0);
 const assignment=randomUUID();await q(`insert into icash_signing_envelopes values($1,$2,$3,'assignment','completed',false,'{}')`,[assignment,account,deal]);
 await q('select icash_sync_title_updates($1,$2)',[account,deal]);let task=await one(`select * from icash_title_tasks where kind='document_update'`);assert.equal(task.payload.envelopeId,assignment);assert.equal((await one(`select count(*)::int n from icash_title_tasks where kind='document_update'`)).n,1);pass('Later signed assignment queues once; initially delivered data is not duplicated');

 await q('update icash_title_followup_settings set enabled=true');assert((await one('select icash_next_automation() job')).job.token);await q('insert into icash_title_replies(account_id,deal_id,request_id,sender_verified,body_text) values($1,$2,$3,true,$4)',[account,deal,title.id,'We opened your file.']);
 const claim=(a=account,payload=task.payload)=>one('select icash_claim_title_update($1,$2,$3) job',[a,task.id,payload]);
 assert.equal((await claim(other)).job,null);assert.equal((await claim(account,{type:'assignment',envelopeId:randomUUID()})).job,null);
 await q('update icash_accounts set bot_paused=true');assert.equal((await claim()).job,null);await q('update icash_accounts set bot_paused=false');
 await q(`insert into icash_property_controls values($1,'fixture',true)`,[account]);assert.equal((await claim()).job,null);await q('update icash_property_controls set manual=false');
 await q(`insert into icash_agreement_cancellations values($1,true)`,[deal]);assert.equal((await claim()).job,null);await q('delete from icash_agreement_cancellations');
 await q('update icash_title_contacts set enabled=false');assert.equal((await claim()).job,null);await q('update icash_title_contacts set enabled=true');
 assert.equal((await claim()).job.recipient,'closer@example.invalid');assert.equal((await claim()).job,null);assert.equal((await one('select count(*)::int n from icash_operation_spend where claimed')).n,1);pass('Exact claim preserves tenant, pause, takeover, cancellation and closer checks');

 const changePayout=async p=>q('update icash_closing_setup set payout=$1,updated_at=clock_timestamp() where deal_id=$2',[p,deal]);
 await changePayout({...payout,detailsSharedWithTitle:true});assert.equal((await one(`select count(*)::int n from icash_title_tasks where payload->>'type'='payout'`)).n,0);
 await changePayout({...payout,method:'wire'});let first=await one(`select * from icash_title_tasks where payload->>'type'='payout'`);
 await changePayout({...payout,method:'wire',detailsSharedWithTitle:true});assert.equal((await one(`select count(*)::int n from icash_title_tasks where payload->>'type'='payout'`)).n,1);
 await changePayout({...payout,method:'check_mail',mailingAddress:'100 Fixture Lane, Dallas TX 75201'});assert.equal((await one('select state from icash_title_tasks where id=$1',[first.id])).state,'cancelled');
 await q(`update icash_title_tasks set email_state='dispatching' where payload->>'type'='payout' and state='scheduled'`);await changePayout(payout);
 assert.equal((await one(`select count(*)::int n from icash_title_tasks where payload->>'type'='payout' and email_state='waiting' and state='scheduled'`)).n,1);pass('Preference revisions replace stale work and correct an in-flight change');

 const visitDate=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
 const data={requestId:request,buyer:'Fixture buyer',start:visitDate+'T14:00',end:visitDate+'T15:00',timezone:'America/Chicago'};
 const manage=async(action,id=null,version=null,p=data,a=account,u=actor)=>(await one('select icash_manage_showing($1,$2,$3,$4,$5,$6,$7) id',[a,u,deal,action,id,version,p])).id;
 await assert.rejects(manage('propose',null,null,data,account,other));const id=await manage('propose');
 await assert.rejects(manage('propose'));await assert.rejects(manage('propose',id));
 await manage('confirm_seller',id,1,{note:'Seller confirmed by phone at 10 AM'});assert.equal((await one('select state from icash_showing_requests where id=$1',[id])).state,'proposed');
 await assert.rejects(manage('confirm_buyer',id,1,{note:'Stale confirmation'}));await manage('confirm_buyer',id,2,{note:'Buyer confirmed the exact time by text'});
 assert.equal((await one('select state from icash_showing_requests where id=$1',[id])).state,'confirmed');pass('Showing needs both confirmations; overlaps and stale edits are rejected');

 await manage('reschedule',id,3,{...data,start:visitDate+'T15:00',end:visitDate+'T16:00',note:'Seller requested a later visit'});
 r=await one('select * from icash_showing_requests where id=$1',[id]);assert.equal(r.state,'proposed');assert.equal(r.seller_confirmed_at,null);assert.equal(r.buyer_confirmed_at,null);assert.equal(r.history.length,3);
 assert.equal((await one(`select count(*)::int n from icash_title_tasks where payload->>'showingId'=$1 and state='scheduled'`,[id])).n,1);
 await manage('cancel',id,4,{note:'Buyer cancelled; seller informed'});assert.equal((await one(`select count(*)::int n from icash_title_tasks where payload->>'showingId'=$1 and state='scheduled'`,[id])).n,0);pass('Reschedule resets confirmations and reminders; cancellation retains audit history');

 for(const role of ['anon','authenticated']){
  assert.equal((await one("select has_function_privilege($1,'icash_manage_showing(uuid,uuid,uuid,text,uuid,integer,jsonb)','execute') allowed",[role])).allowed,false);
  assert.equal((await one("select has_function_privilege($1,'icash_claim_title_update(uuid,uuid,jsonb)','execute') allowed",[role])).allowed,false);
  assert.equal((await one("select has_table_privilege($1,'icash_title_tasks','select') allowed",[role])).allowed,false);
 }
 await q(`update icash_deal_files set stage='cancelled' where id=$1`,[deal]);await assert.rejects(manage('propose'));assert.equal((await one(`select count(*)::int n from icash_title_tasks where state in ('scheduled','needs_review')`)).n,0);pass('Private RPCs stay private and cancelled deals cannot schedule or retain active tasks');
 console.log('Eight focused database scenarios passed. No external calls or paid operations.');
}catch(e){console.error(e.message,e.where??'');process.exitCode=1;}finally{await db.close();}
