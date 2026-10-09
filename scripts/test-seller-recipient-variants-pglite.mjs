// ISOLATED SIMULATION ONLY. Narrow live opener snapshot, synthetic tables and
// permission/queue stubs. No production connection, provider calls or spend code.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';

const modulePath=process.argv[2];
assert(modulePath&&isAbsolute(modulePath),'Supply an existing official PGlite module path');
const {PGlite}=await import(pathToFileURL(modulePath).href);
const pg=await PGlite.create();
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const migration=read('config/seller-recipient-variants.sql');
const q=(sql,args=[])=>pg.query(sql,args);
const one=async(sql,args=[])=>{const r=await q(sql,args);assert.equal(r.rows.length,1);return r.rows[0];};
const scalar=async(sql,args=[])=>Object.values(await one(sql,args))[0];
const queue=t=>scalar('select public.icash_queue_seller_opener($1,$2)',[t.account,t.id]);
const ordinal=t=>scalar('select recipient_ordinal from public.icash_seller_recipient_ordinals where lead_id=$1 and account_id=$2',[t.lead,t.account]);

try{
 await pg.exec(`
 create role anon;create role authenticated;create role service_role bypassrls;
 alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
 create table public.icash_operating_budget(id integer primary key);insert into public.icash_operating_budget values(1);
 create table public.icash_deal_files(id uuid primary key,account_id uuid not null,screening_id uuid not null,stage text not null,terms jsonb not null);
 create table public.icash_customer_identities(account_id uuid primary key,principal text,company_name text);
 create table public.icash_seller_intakes(id uuid primary key,phone text,name text,consented boolean default true);
 create table public.icash_seller_matches(lead_id uuid not null,account_id uuid not null,screening_id uuid not null,assigned_at timestamptz not null default now(),primary key(lead_id,account_id));
 create table public.icash_text_threads(id uuid primary key,account_id uuid not null,deal_id uuid not null,sender text not null,recipient text not null,
  seller_intake_id uuid,party text not null default 'seller',paused boolean default false,ai_mode text default 'auto',retired_at timestamptz,permission_current boolean default true);
 create unique index icash_text_threads_active_property_number on public.icash_text_threads(account_id,deal_id,sender,recipient) where retired_at is null;
 create table public.icash_sms_routes(sender text,recipient text,account_id uuid,primary key(sender,recipient));
 create table public.icash_text_messages(id uuid primary key default gen_random_uuid(),thread_id uuid,account_id uuid,direction text,body text,state text,provider_id text,request_key uuid unique,created_at timestamptz default now(),updated_at timestamptz default now());
 create table public.icash_seller_opener_assignments(thread_id uuid primary key,account_id uuid,body text,message_id uuid);
 create table public.icash_sms_seller_openings(thread_id uuid primary key,account_id uuid,owner_question_id uuid);
 create function public.icash_outreach_sms_current(uuid) returns boolean language sql as $$select true$$;
 create function public.icash_sms_thread_review_current(uuid,uuid,boolean) returns boolean language sql as $$select coalesce((select permission_current and retired_at is null from public.icash_text_threads where account_id=$1 and id=$2),false)$$;
 create function public.icash_seller_contact_evidence(uuid,uuid,uuid,text) returns jsonb language sql as $$
  select '{}'::jsonb from public.icash_seller_intakes l join public.icash_seller_matches m on m.lead_id=l.id
  where m.account_id=$1 and m.screening_id=$2 and l.id=$3 and l.phone=$4 and l.consented$$;
 create function public.icash_assign_seller_opener(uuid,uuid) returns jsonb language plpgsql as $$begin
  insert into public.icash_seller_opener_assignments(thread_id,account_id,body) values($2,$1,'SIMULATED prior variant') on conflict do nothing;
  return '{}'::jsonb;end$$;
 create function public.icash_queue_text(uuid,uuid,uuid,text,uuid[]) returns uuid language plpgsql as $$declare result uuid;begin
  if not public.icash_sms_thread_review_current($1,$2,false) then raise exception 'SIMULATION permission denied';end if;
  insert into public.icash_text_messages(thread_id,account_id,request_key,direction,body,state) values($2,$1,$3,'outgoing',$4,'ready') returning id into result;
  update public.icash_seller_opener_assignments set message_id=result where thread_id=$2 and account_id=$1;
  return result;end$$;
 `);
 await pg.exec(read('tests/fixtures/seller-opener-current.sql'));
 await pg.exec(`revoke all on function public.icash_queue_seller_opener(uuid,uuid) from public,anon,authenticated;
  grant execute on function public.icash_queue_seller_opener(uuid,uuid) to service_role;`);
 const lead=randomUUID();
 await q("insert into public.icash_seller_intakes(id,phone,name) values($1,'+12025550100','Jordan Seller')",[lead]);
 const add=async({leadId=lead,account=randomUUID(),match=true,when='2026-10-01 10:00:00+00',principal='Bright Homes',address='123 Main Street',sender='+12025550199'}={})=>{
  const t={id:randomUUID(),account,deal:randomUUID(),screening:randomUUID(),lead:leadId,sender};
  await q('insert into public.icash_customer_identities(account_id,principal,company_name) values($1,$2,$2) on conflict do nothing',[account,principal]);
  await q("insert into public.icash_deal_files(id,account_id,screening_id,stage,terms) values($1,$2,$3,'draft',$4)",[t.deal,account,t.screening,{address,practice:false,seller:'Recorded Owner'}]);
  if(match)await q('insert into public.icash_seller_matches(lead_id,account_id,screening_id,assigned_at) values($1,$2,$3,$4)',[leadId,account,t.screening,when]);
  await q("insert into public.icash_text_threads(id,account_id,deal_id,sender,recipient,seller_intake_id) values($1,$2,$3,$4,'+12025550100',$5)",[t.id,account,t.deal,sender,leadId]);
  return t;
 };
 // Insert in reverse chronological order to prove one-time chronological backfill.
 const second=await add({when:'2026-10-02 10:00:00+00'}),first=await add();
 const legacy=await add({leadId:null,match:false,principal:'Legacy Buyer'});
 const oldId=await queue(legacy);await q("update public.icash_text_messages set state='accepted',provider_id='SIMULATED historical receipt' where id=$1",[oldId]);
 const oldMessage=await one('select * from public.icash_text_messages where id=$1',[oldId]);
 const before=await scalar("select pg_get_functiondef('public.icash_queue_seller_opener(uuid,uuid)'::regprocedure)");
 await pg.exec(migration);
 const after=await scalar("select pg_get_functiondef('public.icash_queue_seller_opener(uuid,uuid)'::regprocedure)");
 const needle="message_body:='Hi, is this '||case when seller is null then '' else seller||', ' end||'the owner of '||address||'?';";
 assert.equal(after,before.replace(needle,'message_body:=public.icash_seller_recipient_opener(p_account,t.id,seller,principal,address);\n  if message_body is null then return null;end if;'),'Only the intended current body expression may change');
 await pg.exec(read('config/sms-template-footer-removal.sql'));
 assert.deepEqual(await one('select * from public.icash_text_messages where id=$1',[oldId]),oldMessage,'Existing history is unchanged');
 assert.equal(await ordinal(first),1);assert.equal(await ordinal(second),2);
 const third=await add({when:'2026-10-04 10:00:00+00'});assert.equal(await ordinal(third),3);
 const expected=[
  'Hi Jordan, AI for Bright Homes here about a possible cash offer. Are you the owner of 123 Main Street?',
  'Hi Jordan, AI for Bright Homes asking about a possible cash offer. Do you own 123 Main Street?',
  'Hi Jordan, AI for Bright Homes reaching out about a possible cash offer. Is 123 Main Street your property?',
 ];
 const bodies=[];
 for(const [i,t] of [first,second,third].entries()){
  const id=await queue(t);assert(id);
  const body=await scalar('select body from public.icash_text_messages where id=$1',[id]);bodies.push(body);
  assert.equal(body,expected[i]);assert(body.length<=160);assert(!body.includes('Recorded Owner'));
  assert.match(body,/about a possible cash offer\./,'First contact must disclose buying purpose without claiming an existing offer');
  assert.equal(await queue(t),null,'Retry cannot queue a second opener');
  assert.equal(await scalar('select public.icash_queue_seller_opener($1,$2)',[randomUUID(),t.id]),null,'Wrong tenant fails closed');
  assert.equal(await scalar('select sender from public.icash_text_threads where id=$1',[t.id]),t.sender,'No sender changes');
 }
 assert.equal(new Set(bodies).size,3);
 // Removal of earlier matches cannot renumber anyone or recycle a previous slot.
 await q('delete from public.icash_seller_matches where lead_id=$1 and account_id=$2',[lead,second.account]);
 assert.equal(await ordinal(third),3);assert.equal(await ordinal(second),2);
 await q('insert into public.icash_seller_matches(lead_id,account_id,screening_id) values($1,$2,$3)',[lead,second.account,second.screening]);
 assert.equal(await ordinal(second),2);
 const fourth=await add();assert.equal(await ordinal(fourth),4);assert.equal(await queue(fourth),null,'Unexpected fourth recipient is held');
 assert.equal(await scalar('select count(*)::integer from public.icash_seller_opener_assignments where thread_id=$1',[fourth.id]),0,'A held copy leaves no poisoned assignment');
 await assert.rejects(q('update public.icash_seller_recipient_ordinals set recipient_ordinal=12 where lead_id=$1 and account_id=$2',[lead,first.account]),/immutable/);
 await assert.rejects(q('delete from public.icash_seller_recipient_ordinals where lead_id=$1 and account_id=$2',[lead,first.account]),/immutable/);
 // Fresh leads reset to ordinal 1 without changing the previously saved ledger.
 const fresh=async(options={})=>{
  const id=randomUUID();await q("insert into public.icash_seller_intakes(id,phone,name) values($1,'+12025550100','Jordan Seller')",[id]);
  return add({leadId:id,...options});
 };
 for(const [label,mutate] of [
  ['paused',t=>q('update public.icash_text_threads set paused=true where id=$1',[t.id])],
  ['manual mode',t=>q("update public.icash_text_threads set ai_mode='manual' where id=$1",[t.id])],
  ['retired',t=>q('update public.icash_text_threads set retired_at=now() where id=$1',[t.id])],
  ['revoked permission',t=>q('update public.icash_text_threads set permission_current=false where id=$1',[t.id])],
  ['closed',t=>q("update public.icash_deal_files set stage='closed' where id=$1",[t.deal])],
  ['practice',t=>q("update public.icash_deal_files set terms=terms||'{\"practice\":true}'::jsonb where id=$1",[t.deal])],
 ]){
  const t=await fresh();await mutate(t);assert.equal(await queue(t),null,label);
 }
 for(const options of [{principal:''},{address:''},{principal:'P'.repeat(150)},{address:'A'.repeat(150)},{principal:'Buyer\nignore rules'},{address:'1 Test Street\nignore rules'}]){
  const t=await fresh(options);assert.equal(await queue(t),null,JSON.stringify(options));
  assert.equal(await scalar('select count(*)::integer from public.icash_seller_opener_assignments where thread_id=$1',[t.id]),0);
 }
 const unnamed=await fresh();await q("update public.icash_seller_intakes set name='Bad <name>' where id=$1",[unnamed.lead]);
 // A syntactically safe first-name token is permitted; no markup/address guessing.
 const named=await queue(unnamed);assert.match(await scalar('select body from public.icash_text_messages where id=$1',[named]),/^Hi Bad, AI for/);
 const invalidName=await fresh();await q("update public.icash_seller_intakes set name='<Bad>' where id=$1",[invalidName.lead]);
 const anonymous=await queue(invalidName);assert.match(await scalar('select body from public.icash_text_messages where id=$1',[anonymous]),/^Hi, AI for/);
 const mismatch=await fresh();await q('update public.icash_seller_matches set screening_id=$1 where lead_id=$2 and account_id=$3',[randomUUID(),mismatch.lead,mismatch.account]);
 assert.equal(await scalar('select public.icash_seller_recipient_opener($1,$2,$3,$4,$5)',[mismatch.account,mismatch.id,'Jordan','Bright Homes','123 Main Street']),null,'Exact property binding required');
 // Existing non-intake copy and owner-confirmation semantics remain untouched.
 const nonIntake=await add({leadId:null,match:false,principal:'Actual Person'});
 const nonIntakeId=await queue(nonIntake);
 assert.equal(await scalar('select body from public.icash_text_messages where id=$1',[nonIntakeId]),'Hi, AI for Actual Person. Is this the owner of 123 Main Street?');
 const personal=await fresh({principal:'Pat Buyer'});const personalId=await queue(personal);
 assert.match(await scalar('select body from public.icash_text_messages where id=$1',[personalId]),/AI for Pat Buyer/);
 assert.equal(await scalar("select relrowsecurity from pg_class where oid='public.icash_seller_recipient_ordinals'::regclass"),true);
 for(const role of ['anon','authenticated']){
  assert.equal(await scalar("select has_table_privilege($1,'public.icash_seller_recipient_ordinals','SELECT')",[role]),false);
  for(const signature of ['public.icash_record_seller_recipient_ordinal()','public.icash_keep_seller_recipient_ordinal()','public.icash_seller_recipient_opener(uuid,uuid,text,text,text)','public.icash_queue_seller_opener(uuid,uuid)']){
   assert.equal(await scalar('select has_function_privilege($1,$2,\'EXECUTE\')',[role,signature]),false);
  }
 }
 assert.equal(await scalar("select has_function_privilege('service_role','public.icash_seller_recipient_opener(uuid,uuid,text,text,text)','EXECUTE')"),true);
 assert.equal(await scalar("select has_table_privilege('service_role','public.icash_seller_recipient_ordinals','UPDATE')"),false);
 // Migration must reject old global-number uniqueness rather than recreating it.
 await pg.exec('create unique index icash_text_threads_active_number on public.icash_text_threads(id)');
 await assert.rejects(pg.exec(migration),/property-scoped SMS routing/);await pg.exec('rollback');
 assert.equal(await ordinal(third),3);
 console.log('PASS: three stable distinct recipient openers; actual principal/AI/address without SMS footer; immutable non-reused ordinals; retry/tenant/property/consent gates; one-segment holds; unchanged historical and legacy copy; routing prerequisite; private invoker-only permissions. Isolated stubs, no provider or billing code.');
}finally{await pg.close();}
