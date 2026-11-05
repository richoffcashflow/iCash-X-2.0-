import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {sellerDispatchFixture} from './helpers/seller-dispatch-fixture.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const migration=read('config/seller-dispatch-bounded-scan.sql');
const pg=new PGlite(),q=(s,a=[])=>pg.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const id=n=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const scan=(legacy=false)=>v(`select public.${legacy?'icash_next_before_unstarted_sms_recovery':'icash_issue_ready_seller_text'}()`);
const cursor=()=>v('select last_thread_id from icash_work_private.seller_opener_scan where id=1');
const checks=()=>v("select count(*)::integer from fixture_checks where phase='hours'");
const isolated=async fn=>{await pg.exec('begin');try{await fn();}finally{await pg.exec('rollback');}};
try{
 await pg.exec(sellerDispatchFixture({bounded:false}));
 await pg.exec('select fixture_seed(n,1+n%7,false) from generate_series(1,1024)n');
 const finalQueue=await v("select pg_get_functiondef('icash_queue_seller_opener(uuid,uuid)'::regprocedure)");
 assert.equal(await scan(),null);assert.equal(await checks(),1024,'actual dedicated selector was unbounded');
 await pg.exec('truncate fixture_checks');await pg.exec(migration);
 assert.equal(await v("select pg_get_functiondef('icash_queue_seller_opener(uuid,uuid)'::regprocedure)"),finalQueue);
 await isolated(async()=>{
  await pg.exec('set local plan_cache_mode=force_generic_plan');
  for(let page=1;page<=32;page++){
   await pg.exec('truncate fixture_checks');assert.equal(await scan(),null);assert.equal(await checks(),32);assert.equal(await cursor(),id(page*32));
  }
  assert.equal(await scan(),null);assert.equal(await cursor(),null);
  await q('update icash_text_threads set hours_allowed=true where id=$1',[id(1)]);
  assert((await scan())?.token);assert.equal(await cursor(),id(1));
 });
 await isolated(async()=>{
  // Both entry points share progress, including the prior bounded fallback.
  for(let page=1;page<=8;page++){
   await pg.exec('truncate fixture_checks');assert.equal(await scan(true),null);assert.equal(await checks(),64);assert.equal(await cursor(),id(page*64));
  }
 });
 await isolated(async()=>{
  await pg.exec('select fixture_seed(1025,21,true);select fixture_seed(1026,22,true)');
  const served=new Set();
  for(let n=0;n<40&&served.size<2;n++){
   const result=await scan(n%2===0);
   if(result?.token){served.add(await v('select account_id from icash_automation_tickets where token=$1',[result.token]));await pg.exec("update icash_automation_tickets set created_at=now()-interval '2 seconds'");}
  }
  assert.equal(served.size,2,'later funded accounts progress past blocked contacts');
  assert.equal(await v('select count(distinct opener_message_id) from icash_automation_tickets'),2);
 });
 for(const change of ['update icash_accounts set bot_paused=true','update icash_wallets set reserved_cents=balance_cents',"update icash_screening_jobs set completed_at=now()-interval '25 hours'",'update icash_text_threads set paused=true',"update icash_text_threads set ai_mode='manual'",'update icash_text_threads set review_allowed=false',"update icash_text_threads set permission_until=now()-interval '1 second'",'update icash_operating_budget set enabled=false',"insert into icash_text_suppressions select recipient from icash_text_threads", "insert into icash_property_controls select account_id,snapshot->>'propertyId',true from icash_screening_jobs"])await isolated(async()=>{
  await pg.exec('update icash_text_threads set hours_allowed=true;'+change);assert.equal(await scan(),null);assert.equal(await v('select count(*) from icash_text_messages'),0,change);
 });
 for(const state of ['ready','dispatching','needs_review','accepted','delivered','received','cancelled'])await isolated(async()=>{
  await q('update icash_text_threads set hours_allowed=true where id in($1,$2)',[id(1),id(2)]);
  await q("insert into icash_text_messages values(gen_random_uuid(),null,$1,now(),$2,'incoming','saved original')",[id(1),state]);
  assert((await scan())?.token);assert.equal(await cursor(),id(2),'all original global thread history remains excluded');
 });
 await isolated(async()=>{
  await q('update icash_text_threads set hours_allowed=true,review_allowed=false where id=$1',[id(1)]);
  const account=await v('select account_id from icash_text_threads where id=$1',[id(1)]);
  const message=await v("insert into icash_text_messages values(gen_random_uuid(),$1,$2,now(),'ready','outgoing','saved invitation') returning id",[account,id(1)]);
  await q('insert into icash_sms_inbound_invitations values(gen_random_uuid(),$1,$2,now()+interval \'1 hour\')',[id(1),message]);
  const before=await v('select to_jsonb(m) from icash_text_messages m where id=$1',[message]);
  assert((await scan())?.token);assert.equal(await v('select opener_message_id from icash_automation_tickets'),message);
  assert.deepEqual(await v('select to_jsonb(m) from icash_text_messages m where id=$1',[message]),before,'reuse exact unstarted invitation without editing or replaying it');
  await pg.exec("update icash_automation_tickets set created_at=now()-interval '2 seconds';update icash_work_private.seller_opener_scan set last_thread_id=null");
  assert.equal(await scan(),null);assert.equal(await v('select count(*) from icash_automation_tickets'),1);
 });
 await isolated(async()=>{
  await q('update icash_text_threads set hours_allowed=true,review_allowed=false where id=$1',[id(1)]);
  const other=await v('select account_id from icash_text_threads where id=$1',[id(2)]);
  const message=await v("insert into icash_text_messages values(gen_random_uuid(),$1,$2,now(),'ready','outgoing','wrong account') returning id",[other,id(1)]);
  await q('insert into icash_sms_inbound_invitations values(gen_random_uuid(),$1,$2,now()+interval \'1 hour\')',[id(1),message]);
  assert.equal(await scan(),null);assert.equal(await v('select count(*) from icash_automation_tickets'),0,'wrong-account invitation cannot be ticketed');
 });
 for(const role of ['anon','authenticated'])for(const name of ['icash_issue_ready_seller_text()','icash_next_before_unstarted_sms_recovery()'])assert.equal(await v('select has_function_privilege($1,$2,\'execute\')',[role,name]),false);
 assert.equal(await v("select has_table_privilege('service_role','icash_work_private.seller_opener_scan','delete')"),false);
 const names=readdirSync(new URL('../supabase/migrations',import.meta.url)).filter(n=>n.endsWith('_seller_dispatch_bounded_scan.sql'));
 assert.equal(names.length,1);assert.equal(read('supabase/migrations/'+names[0]),migration);
 console.log('PASS bounded seller dispatch: actual direct/legacy selectors, 1024→32 checks, shared cursor/wrap, later-account progress, exact invitations, duplicate/source/control/history guards and service-only ACLs.');
}finally{await pg.close();}
