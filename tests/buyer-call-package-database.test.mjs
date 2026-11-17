import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {setup,apply,enable,api,migration,id,source,projection,started,ended,incoming} from './helpers/buyer-call-package-fixture.mjs';
const pg=await PGlite.create(),{one,capture,claim,final,due}=api(pg);
globalThis.fetch=async()=>{throw Error('Network disabled');};
const isolated=async fn=>{await pg.exec('begin');try{await fn();}finally{await pg.exec('rollback');}};
const history=s=>pg.query('update icash_recorded_reception_private.buyer_history set transcript=$1',[JSON.stringify(projection(s))]);
try{
 await setup(pg);
 // Privilege drift and failed ledger writes cannot partially install anything.
 await pg.exec('begin;grant execute on function icash_claim_text(uuid,uuid,text) to public');
 await assert.rejects(pg.exec(migration),/prerequisite changed/);await pg.exec('rollback');
 await pg.exec('begin');await pg.exec(migration);await assert.rejects(pg.exec('select 1/0'),/division by zero/);await pg.exec('rollback');
 assert.equal((await one("select to_regnamespace('icash_buyer_call_package_private') x")).x,null);
 assert.equal((await one("select md5(pg_get_functiondef('icash_claim_text(uuid,uuid,text)'::regprocedure)) x")).x,'a59a859edb0742485bddd04e49975d60');
 await apply(pg);assert.equal(await capture(),'disabled');assert.equal(await claim(),null);await enable(pg);
 assert.equal((await one("select has_schema_privilege('service_role','icash_buyer_call_package_private','USAGE') x")).x,false);
 assert.equal((await one("select has_function_privilege('anon','icash_capture_buyer_call_package(uuid,text,jsonb)','EXECUTE') x")).x,false);
 await assert.rejects(apply(pg),/prerequisite changed/);

 await isolated(async()=>{
  assert.equal(await capture(),'recorded');assert.equal(await capture(),'recorded');
  let message;
  for(let n=0;n<5;n++){await due();const c=await claim();assert(c);message??=c.messageId;assert.equal(c.messageId,message);assert.equal(await final(message),null);}
  assert.equal((await one('select count(*)::int n from icash_text_messages')).n,1);assert.equal(await claim(),null);
  await pg.exec('update fixture_gates set admit=true');assert(await final(message));assert.equal(await final(message),null);
  await due();assert.equal(await claim(),null);assert.equal((await one('select state from icash_buyer_call_package_private.actions')).state,'needs_review');
  assert.equal((await one('select admissions from fixture_gates')).admissions,1);
 });
 for(const [state,provider,expected] of [['accepted','receipt','accepted'],['delivered','receipt','sent'],['delivered',null,'needs_review'],['dispatching',null,'needs_review'],['needs_review',null,'needs_review'],['failed',null,'needs_review'],['cancelled',null,'needs_review'],['ready','receipt','needs_review']])await isolated(async()=>{
  await capture();const c=await claim();await pg.query('update icash_text_messages set state=$1,provider_id=$2',[state,provider]);await due();assert.equal(await claim(),null);
  assert.equal((await one('select state from icash_buyer_call_package_private.actions')).state,expected);await pg.exec('update fixture_gates set admit=true');assert.equal(await final(c.messageId),null);
  assert.equal((await one('select state from icash_buyer_viewing_requests')).state,state==='delivered'&&provider?'reviewed':'needs_confirmation');
 });
 const invalid=[
  s=>s.complete=false,s=>s.turns.splice(1,1),s=>s.turns[1].message=null,s=>delete s.turns[1].message,s=>s.turns[1].seconds=-1,
  s=>s.turns[1].seconds=601,s=>s.turns[1].seconds='40',s=>s.turns[1].seconds=46,s=>s.startedAt='not a clock',
  s=>s.startedAt=new Date(Date.parse(started)-86400000).toISOString(),s=>s.turns[1].message='x'.repeat(12001),
 ];
 for(const mutate of invalid)await isolated(async()=>{const s=structuredClone(source);mutate(s);assert.equal(await capture(s),'source_held');assert.equal(await claim(),null);});
 // A delayed carrier terminal receipt does not extend original speech time.
 await isolated(async()=>{
  await pg.query("update icash_recorded_reception_private.sessions set created_at=$1::timestamptz-interval '1 hour',call_started_at=$1::timestamptz-interval '1 hour'",[started]);
  await pg.query("update icash_buyer_call_package_private.settings set enabled_at=$1::timestamptz-interval '61 minutes'",[started]);
  assert.equal(await capture(),'source_held');assert.equal(await claim(),null);
 });
 for(const sql of [
  "update icash_recorded_reception_private.sessions set call_profile='owner_quick_test'",
  "update icash_text_threads set owner_buyer_test_id='"+id(9)+"'",
  "update icash_recorded_reception_private.sessions set from_phone='+12145550999'",
  "update icash_recorded_reception_private.sessions set call_terminal_status='failed'",
  "update icash_recorded_reception_private.sessions set call_ended_at=now()+interval '1 hour'",
  "update icash_recorded_reception_private.buyer_bindings set account_id='"+id(9)+"'",
  "update icash_recorded_reception_private.buyer_bindings set thread_id='"+id(9)+"'",
 ])await isolated(async()=>{await pg.exec(sql);assert(['source_held','not_buyer'].includes(await capture()));assert.equal(await claim(),null);});
 await isolated(async()=>{await pg.exec('update icash_buyer_call_package_private.settings set enabled_at=now()');assert.equal(await capture(),'before_cutover');});
 assert.equal(await capture(source,id(7),'conv_other'),'not_buyer');

 for(const text of ["Don't send it.",'Please email me photos','Let me speak to a person','What about title?','Send photos if you cut the price','Wire my deposit','Cancel','Text my partner instead'])await isolated(async()=>{
  const s=structuredClone(source);s.turns.push({role:'user',message:text,seconds:50});await history(s);assert.equal(await capture(s),'no_request');assert.equal(await claim(),null);
 });
 await isolated(async()=>{
  const s=structuredClone(source);s.turns=Array.from({length:120},(_,n)=>({role:n%2?'user':'agent',message:n===1?'Send me the photos':n===61?"Don't send anything.":'Thank you.',seconds:n}));
  await history(s);assert.equal(await capture(s),'no_request','Middle withdrawal survives the old first/last history projection');
 });
 await isolated(async()=>{await capture();const altered=structuredClone(source);altered.turns[1].message='Send me the photos';await history(altered);assert.equal(await capture(altered),'source_conflict');assert.equal(await claim(),null);});

 // A changed middle turn shares the old display projection, but still revokes
 // the original source permanently; restoring the first payload cannot reopen it.
 await isolated(async()=>{
  const original=structuredClone(source);original.turns=Array.from({length:120},(_,n)=>({role:n%2?'user':'agent',message:n===61?'Please send me the photos':'Thank you.',seconds:n}));
  await history(original);assert.equal(await capture(original),'recorded');const c=await claim();assert(c);
  const conflict=structuredClone(original);conflict.turns[71].message="Don't send anything.";assert.deepEqual(projection(original),projection(conflict));
  assert.equal(await capture(conflict),'source_conflict');assert.equal(await capture(original),'source_conflict');
  await due();assert.equal(await claim(),null);await pg.exec('update fixture_gates set admit=true');assert.equal(await final(c.messageId),null);
  assert.equal((await one('select count(*)::int n from icash_buyer_call_package_private.source_conflicts')).n,1);
  assert.deepEqual((await one('select source from icash_buyer_call_package_private.sources')).source,original);
  await pg.query("update icash_text_messages set state='delivered',provider_id='late' where id=$1",[c.messageId]);await due();assert.equal(await claim(),null);
  assert.equal((await one('select state from icash_buyer_viewing_requests')).state,'needs_confirmation');
 });

 // Introduce each durable hold after queueing; final authority must see it.
 const holds=[
  "update icash_text_threads set paused=true", "update icash_text_threads set manual_only=true", "update icash_text_threads set ai_mode='manual'",
  "update icash_accounts set bot_paused=true", "update fixture_gates set allowed=false", "update fixture_gates set review=false", "update fixture_gates set reserved=true",
  "update fixture_gates set price=1", "update icash_buyer_package_links set revoked_at=now()", "update icash_disposition_authorities set expires_at=now()-interval '1 second'",
  "update fixture_gates set price=1;update icash_buyer_package_links set asking_price_cents=1",
  "update icash_buyer_package_links set purchase_envelope_id='"+id(9)+"';update icash_disposition_authorities set purchase_envelope_id='"+id(9)+"'",
  "update icash_buyer_package_links set token=repeat('b',32)",
  "insert into icash_text_suppressions values('+12145550101')",
  "insert into icash_contact_suppressions values(encode(sha256(convert_to('+12145550101','UTF8')),'hex'))",
  "update icash_buyer_call_package_private.settings set enabled=false", "update icash_seller_progress_settings set buyer_reply_enabled=false",
  "update icash_text_threads set recipient='+12145550999'", "update icash_text_threads set account_id='"+id(9)+"'",
  "update icash_text_messages set body='Changed body'", "update icash_text_messages set thread_id='"+id(9)+"'",
  "insert into icash_text_messages(account_id,thread_id,direction,state,body) values('"+id(1)+"','"+id(4)+"','incoming','received','Never mind')",
  "insert into icash_recorded_reception_private.sessions(id,account_id,from_phone,created_at) values('"+id(9)+"','"+id(1)+"','+12145550101',now())",
  "insert into icash_recorded_reception_private.sessions(id,account_id,from_phone,created_at,call_started_at,call_ended_at) values('"+id(9)+"','"+id(1)+"','+12145550101','"+started+"'::timestamptz-interval '1 second','"+started+"'::timestamptz+interval '50 seconds','"+ended+"')",
  "insert into icash_recorded_reception_private.sessions(id,account_id,from_phone,created_at,call_started_at) values('"+id(9)+"','"+id(1)+"','+12145550101',now()-interval '2 days',now()-interval '2 days')",
 ];
 for(const sql of holds)await isolated(async()=>{await capture();const c=await claim();await pg.exec(sql);await pg.exec('update fixture_gates set admit=true');assert.equal(await final(c.messageId),null,sql);assert.equal((await one('select admissions from fixture_gates')).admissions,0);});
 await isolated(async()=>{await capture();const c=await claim();await pg.exec('update fixture_gates set admit=true');assert.equal(await final(c.messageId,id(9)),null);});
 for(const mutation of ["kind='viewing',viewing_quote='Request a showing'","title_quote='Use my title company'","coordination_quote='Photos and a refund'","quote='Changed manually'","state='reviewed',reviewed_at=now()"]){
  await isolated(async()=>{
   await capture();const c=await claim();await pg.exec('update icash_buyer_viewing_requests set '+mutation);
   const original=(await pg.query('select * from icash_buyer_viewing_requests')).rows;
   await pg.query("update icash_text_messages set state='delivered',provider_id='receipt' where id=$1",[c.messageId]);await due();assert.equal(await claim(),null);
   assert.deepEqual((await pg.query('select * from icash_buyer_viewing_requests')).rows,original);
  });
 }
 await isolated(async()=>{
  await capture();await incoming(pg,{body:'old replay',timestamp:Date.parse(started)/1000});
  const c=await claim();assert(c,'Verified original time can prove a delayed reply older');await pg.exec('update fixture_gates set admit=true');assert(await final(c.messageId));
 });
 // The exact production helper accepts zero/wrong-type timestamps; this adapter
 // must not treat that as evidence that newly received intent is an old replay.
 for(const event of [
  {timestamp:0,eventType:'text.delivery.confirmed'}, {timestamp:0}, {timestamp:-1}, {timestamp:'1'},
  {timestamp:Date.now()/1000+3600}, {timestamp:1}, {timestamp:Date.parse(started)/1000,patch:{id:'other'}},
  {timestamp:Date.parse(started)/1000,patch:{type:'text.delivery.confirmed'}},
  {timestamp:Date.parse(started)/1000,phone:'+12145550999'},
  {timestamp:Date.parse(started)/1000,patch:{data:{from:'+12145550101',to:'+12145550999',body:'Please email me instead'}}},
  {timestamp:Date.parse(started)/1000,patch:{data:{from:'+12145550101',to:'+12145550102',body:'different body'}}},
 ])await isolated(async()=>{
  await capture();const c=await claim();const received=await incoming(pg,event);
  if(event.timestamp===0)assert.equal(Number((await one('select icash_sms_reply_time($1) value',[received])).value),0);
  await pg.exec('update fixture_gates set admit=true');assert.equal(await final(c.messageId),null,JSON.stringify(event));
  assert.equal((await one('select count(*)::int n from fixture_reservations')).n,0);
 });
 console.log('PASS actual call-package SQL: prospective/full-source binding, middle withdrawal, immutable replay, one original dispatch, current source/package/contact holds, private ACL and atomic installation.');
}finally{await pg.close();}
