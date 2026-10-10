// Actual reporting SQL with local synthetic data only. No provider calls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID as uuid} from 'node:crypto';
import {validOwnerOverview} from '../lib/owner-overview.ts';
import {validWebinarReport} from '../lib/webinar-reporting.ts';
const {PGlite}=await import(process.argv[2]),pg=new PGlite();
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const clock=sql=>sql.replaceAll('now()',"'2026-11-02T18:00:00Z'::timestamptz");
const q=(sql,args=[])=>pg.query(sql,args),counts=steps=>steps.map(s=>s.count);
const owner='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7',account=uuid(),other=uuid(),today='2026-11-02T08:00:00Z';
let passed=0;
async function scenario(name,fn){await fn();console.log(`PASS ${++passed}/7 ${name}`);}
try{
 await pg.exec(`
 create role anon;create role authenticated;create role service_role;
 create table icash_accounts(id uuid primary key,owner_user_id uuid,legal_name text,assistant_name text);
 create table icash_funding_orders(account_id uuid,mode text,state text,stripe_payment_id text,price_cents bigint,tax_cents bigint,paid_at timestamptz,guest_hash text);
 create table icash_memberships(id uuid primary key,mode text,guest_hash text,account_id uuid);
 create table icash_membership_invoices(membership_id uuid,stripe_payment_id text,amount_cents bigint,recorded_at timestamptz);
 create table icash_billing_reviews(payment_id text);
 create table icash_operation_spend(operation_key text primary key,account_id uuid,state text,charged_cents bigint,actual_micros bigint,cost_basis text,settled_at timestamptz,dispatched_at timestamptz,created_at timestamptz);
 create table icash_usage_coverage(operation_key text,account_id uuid,covered_cents bigint);
 create table icash_seller_intakes(id uuid primary key,canonical_id uuid,name text default 'Fixture seller',address text default 'Fixture property',phone text default '+12145550123',email text,state text default 'received',attribution jsonb,assigned_account uuid,screening_id uuid,assigned_at timestamptz,created_at timestamptz);
 create table icash_seller_matches(lead_id uuid,account_id uuid,screening_id uuid,assigned_at timestamptz);
 create table icash_seller_events(lead_id uuid,event_name text,occurred_at timestamptz);
 create table icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid,stage text,seller_signed_at timestamptz,assignment_signed_at timestamptz,created_at timestamptz);
 create table icash_signing_envelopes(id uuid primary key,account_id uuid,deal_id uuid,kind text,state text,test_mode boolean,provider_id text,created_at timestamptz);
 create table icash_title_replies(id uuid primary key,account_id uuid,deal_id uuid,sender_verified boolean,received_at timestamptz);
 create table icash_closing_updates(id uuid primary key,account_id uuid,deal_id uuid,reply_id uuid,kind text,created_at timestamptz,effective_date date,confirmed_by uuid,confirmation_source text);
 create table icash_timezone_names(name text);insert into icash_timezone_names values('America/Chicago'),('UTC');
 create table icash_webinars(id uuid primary key,config jsonb default '{}',updated_at timestamptz);
 create table icash_webinar_visitors(id uuid primary key,funding_guest_hash text,account_id uuid);
 create table icash_webinar_sessions(id uuid primary key,visitor_id uuid,webinar_id uuid,revision integer default 1,is_preview boolean default false,created_at timestamptz,config jsonb default '{"durationSeconds":1800}',watched_seconds numeric default 0,completed_at timestamptz);
 create table icash_webinar_events(visitor_id uuid,session_id uuid,kind text,created_at timestamptz);
 `);
 await pg.exec(clock(read('config/owner-overview.sql')));
 const attributed=read('supabase/migrations/20261004194452_webinar_variants_and_value_optimization.sql').match(/create function public\.icash_webinar_attributed_purchases\(\)[\s\S]*?\$\$;/)[0];
 const daily=read('supabase/migrations/20261006183014_webinar_public_links_and_session_scope.sql').match(/create or replace function public\.icash_webinar_daily_report\([\s\S]*?end \$\$;/)[0];
 await pg.exec(clock(attributed));await pg.exec(clock(daily));
 const sql=read('config/conversion-funnels.sql');assert.equal(sql,read('supabase/migrations/20261010020902_conversion_funnels.sql'));await pg.exec(sql);
 await q('insert into icash_accounts values($1,$2,\'Fixture business\',\'Fixture bot\'),($3,$3,\'Other business\',\'Other bot\')',[account,owner,other]);
 const ownerReport=async(query='',include=false,actor=owner)=>{
  const r=(await q('select icash_owner_overview_with_funnel($1,1,$2,$3,1) r',[actor,include,query])).rows[0].r;
  assert(validOwnerOverview(r,{days:1,includeOwner:include,query,page:1}));return r;
 };
 const lead=async(stage,at=today)=>{
  const id=uuid(),screening=uuid(),deal=uuid();await q('insert into icash_seller_intakes(id,created_at) values($1,$2)',[id,at]);
  if(stage>=1){await q('insert into icash_seller_matches values($1,$2,$3,$4)',[id,account,screening,at]);await q('update icash_seller_intakes set assigned_account=$2,screening_id=$3,assigned_at=$4 where id=$1',[id,account,screening,at]);}
  if(stage===2)await q("insert into icash_seller_events values($1,'Contact',$2)",[id,at]);
  if(stage>=3){
   await q("insert into icash_deal_files values($1,$2,$3,'closed',$4,$5,$4)",[deal,account,screening,at,stage>=4?at:null]);
   for(const kind of stage>=4?['purchase','assignment']:['purchase'])await q("insert into icash_signing_envelopes values($1,$2,$3,$4,'completed',false,'live-envelope',$5)",[uuid(),account,deal,kind,at]);
   if(stage===5){const reply=uuid();await q('insert into icash_title_replies values($1,$2,$3,true,$4)',[reply,account,deal,at]);await q("insert into icash_closing_updates values($1,$2,$3,$4,'closed',$5,'2026-11-02',null,'verified_title_format')",[uuid(),account,deal,reply,at]);}
  }
  return {id,screening,deal};
 };
 const leads=[];for(let stage=0;stage<=5;stage++)leads.push(await lead(stage));
 await scenario('Seller funnel counts each actual milestone, including verified later steps with missing contact telemetry',async()=>{
  assert.deepEqual(counts((await ownerReport()).funnel),[6,5,4,3,2,1]);
 });
 await scenario('Repeated submissions, multiple assignments, old/future leads and search never inflate the cohort',async()=>{
  const duplicate=await lead(5);await q("update icash_seller_intakes set canonical_id=$2,state='duplicate' where id=$1",[duplicate.id,leads[5].id]);
  await lead(5,'2026-11-01T12:00:00Z');await lead(5,'2026-11-03T12:00:00Z');
  await q('insert into icash_seller_matches values($1,$2,$3,$4)',[leads[5].id,other,leads[5].screening,today]);
  assert.deepEqual(counts((await ownerReport()).funnel),[6,5,4,3,2,1]);
  const searched=await ownerReport('no such lead',true);assert.equal(searched.matchedCount,0);assert.deepEqual(counts(searched.funnel),[6,5,4,3,2,1]);
 });
 await scenario('Test signatures, unverified title replies, future signing dates and a closed stage alone cannot create a closing',async()=>{
  await q("update icash_signing_envelopes set test_mode=true where deal_id=$1 and kind='assignment'",[leads[5].deal]);
  assert.deepEqual(counts((await ownerReport()).funnel),[6,5,4,3,1,0]);
  await q('update icash_signing_envelopes set test_mode=false where deal_id=$1',[leads[5].deal]);
  await q('update icash_title_replies set sender_verified=false where deal_id=$1',[leads[5].deal]);assert.equal((await ownerReport()).funnel.at(-1).count,0);
  await q('update icash_title_replies set sender_verified=true where deal_id=$1',[leads[5].deal]);
  await q("update icash_deal_files set assignment_signed_at='2026-11-03T08:00:00Z' where id=$1",[leads[5].deal]);assert.equal((await ownerReport()).funnel.at(-1).count,0);
  await q('update icash_deal_files set assignment_signed_at=$2 where id=$1',[leads[5].deal,today]);assert.equal((await ownerReport()).funnel.at(-1).count,1);
 });
 const w1=uuid(),w2=uuid();await q('insert into icash_webinars(id,updated_at) values($1,$3),($2,$3)',[w1,w2,today]);
 const visitor=async()=>{const id=uuid();await q('insert into icash_webinar_visitors(id,funding_guest_hash) values($1,$2)',[id,id]);return id;};
 const event=(v,s,kind,at)=>q('insert into icash_webinar_events values($1,$2,$3,$4)',[v,s,kind,at]);
 const session=async(v,w=w1,at=today,preview=false)=>{const id=uuid();await q('insert into icash_webinar_sessions(id,visitor_id,webinar_id,created_at,is_preview) values($1,$2,$3,$4,$5)',[id,v,w,at,preview]);await event(v,id,'started',at);return id;};
 const payment=async(v,at='2026-11-02T09:00:00Z',mode='live',review=false)=>{const id='pi_'+uuid();await q("insert into icash_funding_orders(mode,state,stripe_payment_id,price_cents,paid_at,guest_hash) values($1,'paid',$2,1000,$3,$4)",[mode,id,at,v]);if(review)await q('insert into icash_billing_reviews values($1)',[id]);return id;};
 const a=await visitor(),sa=await session(a);for(const kind of ['pitch_shown','add_to_cart','checkout_started'])await event(a,sa,kind,'2026-11-02T08:30:00Z');
 const firstPayment=await payment(a);await session(a,w1,'2026-11-02T12:00:00Z');await payment(a,'2026-11-02T12:30:00Z');
 // The same payment present as a funding order and membership invoice is still one payment.
 const membership=uuid();await q("insert into icash_memberships values($1,'live',$2,null)",[membership,a]);await q("insert into icash_membership_invoices values($1,$2,1000,'2026-11-02T09:00:00Z')",[membership,firstPayment]);
 const b=await visitor(),sb=await session(b);await event(b,sb,'pitch_shown','2026-11-02T08:30:00Z');
 const c=await visitor(),sc=await session(c);await event(c,sc,'add_to_cart','2026-11-02T07:00:00Z');
 const d=await visitor(),sd=await session(d);await event(d,sd,'checkout_started','2026-11-02T08:30:00Z');
 const e=await visitor();await session(e,w1,'2026-11-01T22:00:00Z');await payment(e);
 const f=await visitor();await session(f,w1,today,true);await payment(f);
 const g=await visitor();await session(g);await session(g,w2,'2026-11-02T10:00:00Z');await payment(g,'2026-11-02T10:10:00Z');
 const h=await visitor();await session(h);await payment(h,undefined,'test');
 const i=await visitor();await session(i);await payment(i,undefined,'live',true);
 const j=await visitor();await session(j,w1,'2026-11-03T08:00:00Z');await payment(j,'2026-11-03T09:00:00Z');
 const k=await visitor(),sk=await session(k,w1,'2026-11-01T05:00:00Z');await event(k,sk,'pitch_shown','2026-11-02T05:59:59Z');await event(k,sk,'checkout_started','2026-11-02T06:00:00Z');
 const webinarReport=async(period='today',zone='America/Chicago')=>{const r=(await q('select icash_webinar_report_with_funnel($1,$2) r',[period,zone])).rows[0].r;assert(validWebinarReport(r,period,zone));return r;};
 await scenario('Viewer funnel deduplicates returning viewers and payments, scopes each webinar, and excludes previews/test/refunded payments',async()=>{
  const r=await webinarReport();assert.deepEqual(counts(r.conversionFunnel.summary),[7,4,3,3,2]);
  assert.deepEqual(counts(r.conversionFunnel.webinars.find(w=>w.webinarId===w1).steps),[7,3,2,2,1]);
  assert.deepEqual(counts(r.conversionFunnel.webinars.find(w=>w.webinarId===w2).steps),[1,1,1,1,1]);
  assert.equal(r.summary.purchases,4,'Payment-date cards retain earlier viewers and separate purchases');
 });
 await scenario('Yesterday includes the full 25-hour DST day and does not pull in today’s conversions; wider periods follow their own viewers',async()=>{
  const r=await webinarReport('yesterday');assert.equal(Date.parse(r.endsAt)-Date.parse(r.startsAt),25*3600000);assert.deepEqual(counts(r.conversionFunnel.summary),[2,1,0,0,0]);
  assert.deepEqual(counts((await webinarReport('7d')).conversionFunnel.summary),[9,6,5,5,3]);
  await assert.rejects(webinarReport('bad'),/Invalid report period/);await assert.rejects(webinarReport('today','Bad/Zone'),/Invalid report timezone/);
 });
 await scenario('New reports are read-only service-role functions and the seller owner gate cannot be bypassed',async()=>{
  for(const name of ['icash_owner_overview_with_funnel(uuid,integer,boolean,text,integer)','icash_webinar_report_with_funnel(text,text)']){
   for(const role of ['anon','authenticated','service_role'])assert.equal((await q('select has_function_privilege($1,$2,\'execute\') allowed',[role,name])).rows[0].allowed,role==='service_role');
   const p=(await q('select prosecdef,provolatile,proconfig from pg_proc where oid=$1::regprocedure',[name])).rows[0];assert.equal(p.prosecdef,false);assert.equal(p.provolatile,'s');assert(p.proconfig.includes('search_path=""'));
  }
  await assert.rejects(ownerReport('',false,other),/Owner required/);await assert.rejects(ownerReport('',false,null),/Owner required/);
 });
 await scenario('A real empty period returns complete zero funnels with every saved webinar selectable',async()=>{
  await pg.exec('truncate icash_seller_intakes,icash_webinar_events,icash_funding_orders,icash_membership_invoices');
  assert.deepEqual(counts((await ownerReport()).funnel),[0,0,0,0,0,0]);
  const r=await webinarReport();assert.deepEqual(counts(r.conversionFunnel.summary),[0,0,0,0,0]);assert.equal(r.conversionFunnel.webinars.length,2);assert(r.conversionFunnel.webinars.every(w=>w.steps.every(s=>s.count===0)));
 });
 assert.equal(passed,7);
}finally{await pg.close();}
