// One atomic migration + actual submit/lookup/contact/selector/permission/admission.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {setupOwnerDemoRestartFixture} from './helpers/owner-demo-restart-fixture.mjs';
import {assertOwnerDemoRestartParity} from './helpers/owner-demo-restart-parity.mjs';
const pg=await PGlite.create(),q=(s,a=[])=>pg.query(s,a),one=async(s,a=[])=>(await q(s,a)).rows[0],val=async(s,a=[])=>Object.values(await one(s,a))[0];
const A='48dfb798-8c1a-404f-88c0-c396cc067062',O='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7',P='+12142185280',S='+17208134296';
const bundle=readFileSync('config/owner-demo-restart.sql','utf8');assertOwnerDemoRestartParity('distinct-demo-submissions');
const fn=(name,args)=>val(`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})`,args);
const submit=async()=>{const args=[O,A,randomUUID(),'a'.repeat(64),'Fixture Owner','100 Test Lane, Dallas, TX 75201',P,true,'b'.repeat(64),'America/Chicago','c'.repeat(64)];return {args,id:await fn('icash_submit_bot_demo_intake',args)};};
const assign=async()=>{
 const r=await submit(),token=randomUUID();r.screen=randomUUID();r.deal=randomUUID();
 await q("update icash_seller_intakes set state='checking',claim_token=$2,claimed_at=now(),lookup_cap_micros=0,lookup_costs='{\"dealmachine\":0}',data_rights_until=now()+interval '1 day' where id=$1",[r.id,token]);
 assert.equal(await fn('icash_finish_seller_lookup',[r.id,token,{creditsUsed:0,numbersPassed:true,status:'qualified',property:{id:'same-property',city:'Dallas',state:'TX'},result:{financialCheck:{status:'eligible'},preliminarySellerCeilingCents:8000000}}]),true);
 assert.equal(await val('select canonical_id from icash_seller_intakes where id=$1',[r.id]),null);
 // Assignment operation economics are tested independently by bot-demo-pglite.
 // Exact assigned source rows here feed the unchanged current contact pipeline.
 await q("update icash_seller_intakes set state='assigned',assigned_account=$2,screening_id=$3 where id=$1",[r.id,A,r.screen]);
 await q("insert into icash_screening_jobs(id,account_id,state,snapshot) values($1,$2,'complete','{\"propertyId\":\"same-property\"}')",[r.screen,A]);
 await q('insert into icash_seller_matches(lead_id,account_id,screening_id) values($1,$2,$3)',[r.id,A,r.screen]);
 await q("insert into icash_deal_files(id,account_id,screening_id,stage,terms) values($1,$2,$3,'draft','{\"address\":\"100 Test Lane, Dallas, TX 75201\"}')",[r.deal,A,r.screen]);
 await q("insert into icash_optin_call_requests select id,request_id,phone,$2,$3,'demo_form','icash-optin-call-now-2026-10-16.1','icash-optin-call-now-2026-10-16.1',now(),now()+interval '5 minutes' from icash_seller_intakes where id=$1",[r.id,A,O]);
 return r;
};
const prepare=async r=>{
 await fn('icash_prepare_seller_contacts',[A,r.id,r.screen,r.deal]);
 r.thread=await val('select id from icash_text_threads where seller_intake_id=$1',[r.id]);r.permission=await val('select id from icash_contact_permissions where seller_intake_id=$1',[r.id]);assert(r.thread&&r.permission);
 assert.equal(await fn('icash_seller_voice_permission_current',[A,r.permission]),true);
 assert.equal(await fn('icash_property_text_sender',[A,r.deal,P]),S);assert.equal(await fn('icash_property_call_sender',[A,r.screen,P]),S);
 r.job=randomUUID();await q("insert into icash_voice_jobs(id,account_id,permission_id,state,created_at) values($1,$2,$3,'issued',clock_timestamp())",[r.job,A,r.permission]);
 assert.equal(await fn('icash_owner_demo_call_current',[A,r.job]),true);return r;
};
const fresh=async()=>prepare(await assign());
const activate=r=>fn('icash_demo_run_private.activate',[A,r.id]);
const reserve=async r=>fn('icash_reserve_paced_voice',[A,r.job,rate,new Date(Date.now()+120000).toISOString(),null,false]);
const rate=randomUUID();
const recording=async r=>{
 const id=randomUUID();await q("insert into icash_operation_spend(operation_key,account_id,state,permission_until) values($1,$2,'dispatched',now()+interval '5 minutes') on conflict(operation_key) do update set state='dispatched'",['voice:'+r.job,A]);
 await q("insert into icash_call_recordings(id,account_id,voice_job_id,permission_id,screening_id,from_phone,to_phone,party,state,operation_key,consent_deadline_at,row_version) values($1,$2,$3,$4,$5,$6,$7,'seller','consent_pending',$8,now()+interval '1 minute',0)",[id,A,r.job,r.permission,r.screen,S,P,'voice:'+r.job]);return id;
};
const dial=(r,id)=>fn('icash_transition_call_recording',[id,A,'voice:'+r.job,'consent_pending','claim_dial',{}]);
let scenarios=0;
const scenario=async(name,test)=>{await pg.exec('begin');try{await test();scenarios++;}catch(e){throw new Error(name+': '+e.message,{cause:e});}finally{await pg.exec('rollback');}};
try{
 await setupOwnerDemoRestartFixture({pg,account:A,owner:O,other:randomUUID(),phone:P,sender:S});
 const signature='icash_submit_bot_demo_intake(uuid,uuid,uuid,text,text,text,text,boolean,text,text,text)',original=await val('select pg_get_functiondef($1::regprocedure)',[signature]);
 const core=await val("select pg_get_functiondef('icash_business_conversation_sender(uuid,uuid,text,boolean)'::regprocedure)");
 await pg.exec(core.replace('order by encode(sha256','order by  encode(sha256'));
 await assert.rejects(pg.exec('begin;'+bundle+'commit;'),/ranking order changed/);await pg.exec('rollback');
 assert.equal(await val('select pg_get_functiondef($1::regprocedure)',[signature]),original);assert.equal(await val("select to_regnamespace('icash_demo_run_private')"),null);assert.equal(await val("select to_regprocedure('icash_owner_demo_sender_rank(text)')"),null);
 await pg.exec(core);
 // Receipt is part of the caller transaction: collision must roll back all DDL.
 await pg.exec("create table fixture_migration_receipts(version text primary key);insert into fixture_migration_receipts values('collision');");
 await assert.rejects(pg.exec('begin;'+bundle+"insert into fixture_migration_receipts values('collision');commit;"),/duplicate key/);await pg.exec('rollback');
 assert.equal(await val('select pg_get_functiondef($1::regprocedure)',[signature]),original);assert.equal(await val("select to_regnamespace('icash_demo_run_private')"),null);assert.equal(await val("select to_regprocedure('icash_owner_demo_sender_rank(text)')"),null);assert.equal(await val('select count(*) from icash_request_limits'),0);
 await pg.exec('begin;'+bundle+'commit;');
 await q("insert into icash_operation_rates(id,operation,enabled) values($1,'seller_call',true)",[rate]);
 await scenario('eight same-address runs through actual routing',async()=>{
  let prior;for(let i=0;i<8;i++){const r=await fresh();assert.equal(await fn('icash_submit_bot_demo_intake',r.args),r.id);if(prior){assert.equal(await val('select state from icash_screening_jobs where id=$1',[prior.screen]),'archived');assert.equal(await fn('icash_owner_demo_call_current',[A,prior.job]),false);}prior=r;}
  assert.equal(await val('select count(*) from icash_demo_run_private.runs'),8);assert.equal(await val('select count(*) from icash_text_threads where retired_at is null'),1);assert.equal(await val('select count(distinct sender) from icash_text_threads'),1);assert.equal(await val('select count(distinct screening_id) from icash_seller_matches'),8);
 });
 await scenario('real reservation and final-dial gate, unknown prevents overlap',async()=>{
  const a=await fresh();assert.equal(await reserve(a),true);const id=await recording(a);assert(await dial(a,id));assert.equal(await dial(a,id),null,'dial receipt never replayed');
  const b=await assign(),expiry=await val('select expires_at from icash_optin_call_requests where lead_id=$1',[b.id]);assert.equal(await activate(b),false);
  assert.equal(await val('select count(*) from fixture_reservation_attempts'),1);assert.equal(await val('select retired_at from icash_text_threads where id=$1',[a.thread]),null);
  assert.deepEqual(await val('select expires_at from icash_optin_call_requests where lead_id=$1',[b.id]),expiry);
 });
 await scenario('new latest run reserves, retired predecessor cannot',async()=>{
  const a=await fresh(),b=await fresh();assert.equal(await reserve(a),false);assert.equal(await reserve(b),true);
  const record=await recording(b);assert(await dial(b,record));assert.equal(await val('select count(*) from fixture_reservation_attempts'),1);
 });
 await scenario('expired exact original receipt cannot reserve or dial',async()=>{
  const r=await fresh();await q("update icash_optin_call_requests set requested_at=now()-interval '6 minutes',expires_at=now()-interval '1 minute' where lead_id=$1",[r.id]);assert.equal(await reserve(r),false);const record=await recording(r);assert.equal(await dial(r,record),null);assert.equal(await val('select count(*) from fixture_reservation_attempts'),0);
 });
 await scenario('limited wrapper composes with distinct identity and lifecycle',async()=>{
  const runs=[];for(let i=0;i<5;i++){
   const args=[O,A,randomUUID(),'a'.repeat(64),'Fixture Owner','100 Test Lane, Dallas, TX 75201',P,true,'b'.repeat(64),'America/Chicago','c'.repeat(64),'d'.repeat(64)];
   runs.push({args,id:await fn('icash_submit_limited_bot_demo_intake',args)});
  }
  assert.equal(new Set(runs.map(r=>r.id)).size,5);assert.equal(await val('select count(*) from icash_demo_run_private.runs'),5);
  const before=await val('select jsonb_agg(to_jsonb(l) order by bucket) from icash_request_limits l');
  for(let i=0;i<8;i++)assert.equal(await fn('icash_submit_limited_bot_demo_intake',runs[0].args.map((v,j)=>j===11?'e'.repeat(64):v)),runs[0].id);
  assert.deepEqual(await val('select jsonb_agg(to_jsonb(l) order by bucket) from icash_request_limits l'),before);
  await pg.exec('savepoint sixth');await assert.rejects(fn('icash_submit_limited_bot_demo_intake',runs[0].args.map((v,j)=>j===2?randomUUID():v)),/Demo submission limit reached/);await pg.exec('rollback to sixth');
  await pg.exec('savepoint mismatch');await assert.rejects(fn('icash_submit_limited_bot_demo_intake',runs[0].args.map((v,j)=>j===4?'Changed name':v)),/retry mismatch/);await pg.exec('rollback to mismatch');
  assert.equal(await val('select count(*) from icash_demo_run_private.runs'),5);assert.deepEqual(await val('select jsonb_agg(to_jsonb(l) order by bucket) from icash_request_limits l'),before);
 });
 await scenario('STOP remains binding across new same-phone request',async()=>{
  const a=await fresh();await q('insert into icash_text_suppressions(phone) values($1)',[P]);const b=await assign();assert.equal(await activate(b),false);assert.equal(await fn('icash_property_call_sender',[A,a.screen,P]),null);assert.equal(await reserve(a),false);
 });
 console.log(`PASS atomic owner demo restart: ${scenarios} combined scenarios; current lookup/contact prep/routing/permission/phone gates/final reservation+claim, eight same-address runs, unknown holds, original expiry, STOP, late guard and receipt rollback. External eligibility and reserve ledger are explicit offline boundaries.`);
}catch(e){console.error(e.message);console.error(e.cause?.message,e.cause?.where);process.exitCode=1;}finally{await pg.close();}
