// Synthetic Postgres only. Run with a local PGlite module path; no production or provider calls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href),db=await PGlite.create();
const account=randomUUID(),actor=randomUUID(),other=randomUUID();
const query=(sql,args=[])=>db.query(sql,args);
const one=async(sql,args=[])=> (await query(sql,args)).rows[0];
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create table auth.users(id uuid primary key);
 create table public.icash_accounts(id uuid primary key,owner_user_id uuid);
 create table public.icash_operating_budget(id int primary key);insert into public.icash_operating_budget values(1);
 create table public.icash_screening_jobs(id uuid primary key,account_id uuid,snapshot jsonb);
 create table public.icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid,terms jsonb default '{}',stage text default 'draft' check(stage in ('draft','under_contract','buyer_selected','title_open','closing','closed')),seller_signed_at timestamptz,assignment_signed_at timestamptz,title_verified_at timestamptz,funded_at timestamptz,updated_at timestamptz default now());
 create table public.icash_signing_envelopes(id uuid primary key,account_id uuid,deal_id uuid,kind text,test_mode boolean default false,state text check(state in ('creating','awaiting_counterparty','customer_signature_needed','completed','test_completed','needs_review')),provider_id text unique,provider_status text,provider_evidence jsonb,terms jsonb default '{}',updated_at timestamptz default now(),unique(deal_id,kind,test_mode));
 create table public.icash_signature_authorizations(envelope_id uuid,account_id uuid,state text);
 create table public.icash_property_controls(account_id uuid,property_id text,manual boolean,updated_at timestamptz,primary key(account_id,property_id));
 create table public.icash_buyer_deposit_receipts(id uuid primary key default gen_random_uuid(),account_id uuid,deal_id uuid unique,envelope_id uuid,amount_cents bigint);
 create table public.icash_title_requests(id uuid primary key default gen_random_uuid(),account_id uuid,deal_id uuid,state text);
 create table public.icash_closing_updates(id uuid default gen_random_uuid(),account_id uuid,deal_id uuid,kind text,amount_cents bigint,confirmed_by uuid);
 create table public.icash_closing_setup(account_id uuid,deal_id uuid,state text,review_reason text,updated_at timestamptz);
 create table public.icash_text_threads(id uuid primary key,account_id uuid,deal_id uuid,party text,paused boolean default false);
 create table public.icash_text_messages(id uuid primary key default gen_random_uuid(),thread_id uuid,account_id uuid,direction text,state text);
 create table public.icash_fulfillment_jobs(id uuid primary key default gen_random_uuid(),account_id uuid,deal_id uuid,state text,updated_at timestamptz);
 create table public.icash_live_callbacks(account_id uuid,screening_id uuid,state text);
 create table public.icash_buyer_package_links(account_id uuid,deal_id uuid,revoked_at timestamptz);
 create table public.icash_title_replies(id uuid primary key,account_id uuid,deal_id uuid,received_at timestamptz);
 create function public.icash_save_signing_status(p_id uuid,p_state text,p_evidence jsonb) returns void language plpgsql as $$begin update public.icash_signing_envelopes set state=p_state,provider_evidence=p_evidence where id=p_id;end$$;
 create function public.icash_buyer_is_reserved(p_account uuid,p_deal uuid) returns boolean language sql as $$select exists(select 1 from public.icash_buyer_deposit_receipts where account_id=p_account and deal_id=p_deal)$$;
 create function public.icash_buyer_outreach_held(uuid,uuid) returns boolean language sql as $$select false$$;
 create function public.icash_set_work_control(p_user uuid,p_account uuid,p_action text,p_screening uuid default null) returns void language plpgsql as $$begin update public.icash_property_controls set manual=false where account_id=p_account and property_id=p_screening::text;end$$;
 create function public.icash_confirm_closing_update(p_account uuid,p_actor uuid,p_deal uuid,p_reply uuid,p_kind text,p_date date default null,p_amount bigint default null,p_file text default '') returns uuid language sql as $$select gen_random_uuid()$$;
 `);
 await db.exec(readFileSync(new URL('../supabase/migrations/20261010045243_agreement_cancellation.sql',import.meta.url),'utf8'));
 await db.exec('create trigger deposit_receipt after insert on public.icash_closing_updates for each row execute function public.icash_reserve_from_closing_deposit()');
 await query('insert into auth.users values($1),($2)',[actor,other]);await query('insert into public.icash_accounts values($1,$2)',[account,actor]);
 const fixture=async(stage='draft')=>{
  const deal=randomUUID();await query('insert into public.icash_screening_jobs values($1,$2,$3)',[deal,account,{propertyId:deal}]);
  await query("insert into public.icash_deal_files(id,account_id,screening_id,terms,stage,seller_signed_at) values($1,$2,$1,$3,$4,case when $4<>'draft' then now() end)",[deal,account,{assignee:'Original buyer',priceCents:12300000},stage]);return deal;
 };
 let providerSequence=100;
 const envelope=async(deal,kind,state='completed',provider=String(++providerSequence))=>{
  const id=randomUUID();await query('insert into public.icash_signing_envelopes(id,account_id,deal_id,kind,state,provider_id) values($1,$2,$3,$4,$5,$6)',[id,account,deal,kind,state,provider]);return id;
 };
 const preview=async(deal,user=actor)=>(await one('select public.icash_cancellation_preview($1,$2,$3) as v',[account,user,deal])).v;
 const request=async(deal,kind='purchase',key=randomUUID(),revision=null,user=actor,reason='Fixture cancellation')=>(await one('select public.icash_request_cancellation($1,$2,$3,$4,$5,$6,$7) as id',[account,user,deal,kind,reason,key,revision??(await preview(deal)).revision])).id;
 const finish=async(id,confirmed=false,release='',resolution='')=>(await one('select public.icash_finish_cancellation($1,$2,$3,$4,$5,$6) as done',[account,actor,id,confirmed,release,resolution])).done;
 const check=async(id,e,outcome='expired',signed=false)=>{
  const row=await one('select provider_id from public.icash_signing_envelopes where id=$1',[e]);
  await query('select public.icash_record_cancellation_check($1,$2,$3,$4,$5,$6,$7)',[account,actor,id,e,row.provider_id,outcome,signed]);
 };
 // Unsigned deal: owner, fresh review, idempotency, queued messages and return-to-bot guard.
 const unsigned=await fixture(),unsignedEnvelope=await envelope(unsigned,'purchase','awaiting_counterparty');
 await assert.rejects(()=>preview(unsigned,other),/Owner required/);
 await assert.rejects(()=>request(unsigned,'purchase',randomUUID(),'stale'),/Agreement changed/);
 const thread=randomUUID();await query("insert into public.icash_text_threads(id,account_id,deal_id,party) values($1,$2,$3,'seller')",[thread,account,unsigned]);
 await query("insert into public.icash_text_messages(thread_id,account_id,direction,state) values($1,$2,'outgoing','ready'),($1,$2,'outgoing','dispatching')",[thread,account]);
 await query("insert into public.icash_signature_authorizations values($1,$2,'authorized')",[unsignedEnvelope,account]);
 const key=randomUUID(),id=await request(unsigned,'purchase',key);assert.equal(await request(unsigned,'purchase',key),id);
 await assert.rejects(()=>request(unsigned,'purchase',key,null,actor,'Different reason'),/key already used/);
 assert.equal((await one('select stage from public.icash_deal_files where id=$1',[unsigned])).stage,'cancellation_pending');
 assert.deepEqual((await query('select state from public.icash_text_messages order by state')).rows.map(x=>x.state),['cancelled','dispatching']);
 assert.equal((await one('select state from public.icash_signature_authorizations where envelope_id=$1',[unsignedEnvelope])).state,'revoked');
 await assert.rejects(()=>query("select public.icash_set_work_control($1,$2,'return_to_bot',$3)",[actor,account,unsigned]),/Resolve cancellation/);
 await assert.rejects(()=>query("update public.icash_deal_files set stage='closed' where id=$1",[unsigned]),/Resolve cancellation/);
 assert.equal(await finish(id),false,'provider uncertainty keeps cancellation pending');
 await check(id,unsignedEnvelope);assert.equal(await finish(id),true);assert.equal(await finish(id),true);
 assert.equal((await preview(unsigned)).stage,'cancelled');
 await assert.rejects(()=>query("update public.icash_deal_files set stage='under_contract' where id=$1",[unsigned]),/retained for history/);
 assert.equal((await one('select manual from public.icash_property_controls where property_id=$1',[unsigned])).manual,true);

 // Signed assignment: explicit release and title/deposit disposition, then a fresh buyer and receipt.
 const deal=await fixture('buyer_selected'),purchase=await envelope(deal,'purchase'),buyer=await envelope(deal,'assignment');
 await query('insert into public.icash_buyer_deposit_receipts(account_id,deal_id,envelope_id,amount_cents) values($1,$2,$3,200000)',[account,deal,buyer]);
 await query("insert into public.icash_title_requests(account_id,deal_id,state) values($1,$2,'sent')",[account,deal]);
 const oldReply=randomUUID();await query("insert into public.icash_title_replies values($1,$2,$3,now()-interval '1 day')",[oldReply,account,deal]);
 await query("insert into public.icash_fulfillment_jobs(account_id,deal_id,state) values($1,$2,'ready')",[account,deal]);
 const assignmentId=await request(deal,'assignment');await check(assignmentId,buyer,'completed',true);
 assert.equal(await finish(assignmentId),false);assert.equal(await finish(assignmentId,true,'Signed release 123',''),false);
 assert.equal(await finish(assignmentId,true,'Signed release 123','Closer confirmed release and deposit disposition'),true);
 assert.equal((await one('select state from public.icash_signing_envelopes where id=$1',[purchase])).state,'completed');
 const kept=await one('select stage,terms from public.icash_deal_files where id=$1',[deal]);assert.equal(kept.stage,'under_contract');assert.equal(kept.terms.assignee,'');assert.equal(kept.terms.priceCents,12300000);
 assert.equal((await one('select public.icash_buyer_is_reserved($1,$2) as reserved',[account,deal])).reserved,false);
 await query("select public.icash_set_work_control($1,$2,'return_to_bot',$3)",[actor,account,deal]);
 assert.equal((await one('select state from public.icash_fulfillment_jobs where deal_id=$1',[deal])).state,'ready','explicit resume restarts buyer sourcing');
 const replacement=await envelope(deal,'assignment');
 await query("insert into public.icash_closing_updates(account_id,deal_id,kind,amount_cents) values($1,$2,'deposit_received',200000)",[account,deal]);
 assert.equal((await one('select public.icash_buyer_is_reserved($1,$2) as reserved',[account,deal])).reserved,false,'old title thread cannot book the new buyer deposit');
 await assert.rejects(()=>envelope(deal,'assignment'),/duplicate key/);
 await assert.rejects(()=>query("select public.icash_confirm_closing_update($1,$2,$3,$4,'deposit_received')",[account,actor,deal,oldReply]),/new closing confirmation/);
 const freshReply=randomUUID();await query('insert into public.icash_title_replies values($1,$2,$3,clock_timestamp())',[freshReply,account,deal]);
 await assert.rejects(()=>query("select public.icash_confirm_closing_update($1,$2,$3,$4,'closed')",[account,actor,deal,freshReply]),/current buyer deposit/);
 await query('insert into public.icash_buyer_deposit_receipts(account_id,deal_id,envelope_id,amount_cents) values($1,$2,$3,200000)',[account,deal,replacement]);
 assert.equal((await one('select count(*)::int as n from public.icash_buyer_deposit_receipts where deal_id=$1',[deal])).n,2,'old receipt retained separately');
 assert.equal((await one('select public.icash_buyer_is_reserved($1,$2) as reserved',[account,deal])).reserved,true);
 await query("select public.icash_confirm_closing_update($1,$2,$3,$4,'closed')",[account,actor,deal,freshReply]);
 // Late old callbacks cannot select that buyer or replace the new agreement.
 const oldProvider=(await one('select provider_id from public.icash_signing_envelopes where id=$1',[buyer])).provider_id;
 await query("select public.icash_save_signing_status($1,'completed',$2)",[buyer,{id:oldProvider,test_mode:false,status:'Completed'}]);
 assert.equal((await one('select state from public.icash_signing_envelopes where id=$1',[buyer])).state,'cancelled');
 assert.equal((await one('select state from public.icash_signing_envelopes where id=$1',[replacement])).state,'completed');

 // In-flight creation has no assumed success: save its late ID, expire it, retain late activity.
 const inflight=await fixture(),creating=await envelope(inflight,'purchase','creating',null),creationId=await request(inflight);
 assert.equal(await finish(creationId),false);
 await query("update public.icash_signing_envelopes set provider_id='999',state='awaiting_counterparty' where id=$1",[creating]);
 assert.equal((await one('select state from public.icash_signing_envelopes where id=$1',[creating])).state,'cancellation_pending');
 await check(creationId,creating);assert.equal(await finish(creationId),true);
 await query("select public.icash_save_signing_status($1,'completed',$2)",[creating,{id:'999',status:'Completed',test_mode:false}]);
 assert.equal((await preview(inflight)).requests[0].late_activity,true);
 assert.equal((await preview(inflight)).stage,'cancelled');
 // Seller cancellation cascades to the buyer; draft without signing has nothing to expire.
 const cascade=await fixture('buyer_selected'),cp=await envelope(cascade,'purchase'),ca=await envelope(cascade,'assignment'),cascadeId=await request(cascade);
 await check(cascadeId,cp,'completed',true);assert.equal(await finish(cascadeId,true,'Mutual release 42'),false);
 await check(cascadeId,ca,'completed',true);assert.equal(await finish(cascadeId,true,'Mutual release 42'),true);
 assert.equal((await one("select count(*)::int as n from public.icash_signing_envelopes where deal_id=$1 and state='cancelled'",[cascade])).n,2);
 const draft=await fixture();assert.equal(await finish(await request(draft)),true);
 await assert.rejects(async()=>request(await fixture('closed')),/current state/);
 const funded=await fixture('closing');await query('update public.icash_deal_files set funded_at=now() where id=$1',[funded]);await assert.rejects(()=>request(funded),/current state/);
 for(const role of ['anon','authenticated']){
  assert.equal((await one("select has_table_privilege($1,'public.icash_agreement_cancellations','SELECT,INSERT,UPDATE,DELETE') as allowed",[role])).allowed,false);
  assert.equal((await one("select has_function_privilege($1,'public.icash_request_cancellation(uuid,uuid,uuid,text,text,uuid,text)','EXECUTE') as allowed",[role])).allowed,false);
 }
 console.log('PASS cancellation migration: ownership, stale review, replay, provider uncertainty, signed release, deposit history, replacement buyer, late callbacks, cascading cancellation, closed/funded guards and private permissions.');
}finally{await db.close();}
