// Real persistent PostgreSQL sessions, original queue/admission functions only.
import assert from 'node:assert/strict';
import {Client,connection} from './preparation-native-db.mjs';
export async function verifyPreparationContention(f){
 const {q,one,account}=f;
 const a=new Client({...connection,application_name:'preparation-holder'});
 const b=new Client({...connection,application_name:'preparation-waiter'});
 let pending;
 const start=(sql,args=[])=>{pending=b.query(sql,args);pending.catch(()=>{});return pending;};
 const snapshot=async()=>{
  const result={};
  for(const table of ['icash_wallets','icash_operating_budget','icash_operation_spend','icash_credit_reservations','icash_cost_observations','icash_owner_contacts','icash_dealmachine_dnc_ingestions'])
   result[table]=(await q(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) value from ${table} t`)).rows[0].value;
  return result;
 };
 const count=async()=>Number((await one('select count(*) n from icash_operational_contacts where account_id=$1',[account])).n);
 const queued=()=>start('select icash_queue_voice_jobs()');
 const lockBudget=async()=>{await a.query('begin');await a.query('select 1 from icash_operating_budget where id=1 for update');};
 try{
  await a.connect();await b.connect();
  await a.query("set statement_timeout='10s';set lock_timeout='8s'");
  await b.query("set statement_timeout='10s';set lock_timeout='8s';set role service_role");
  const aid=(await a.query('select pg_backend_pid() pid')).rows[0].pid;
  const bid=(await b.query('select pg_backend_pid() pid')).rows[0].pid;
  const blocked=async(label)=>{
   const until=Date.now()+5000;
   while(Date.now()<until){
    const row=await one('select wait_event_type, $2::int=any(pg_blocking_pids(pid)) held from pg_stat_activity where pid=$1',[bid,aid]);
    if(row.wait_event_type==='Lock'&&row.held)return;
    await new Promise(resolve=>setTimeout(resolve,10));
   }
   assert.fail(label+' must demonstrably wait on the other backend');
  };
  const immutableBefore=await snapshot();
  const receiptsBefore=(await q('select to_jsonb(r) value from icash_dnc_verification_receipts r order by id')).rows;
  const queueDefinition=(await one("select pg_get_functiondef('icash_queue_voice_jobs()'::regprocedure) body")).body;
  assert(queueDefinition.includes('pg_advisory_xact_lock(726341927)'));
  assert(queueDefinition.indexOf('icash_operating_budget')<queueDefinition.indexOf('icash_prepare_operational_contacts'));

  // Two queue invocations really overlap: the first retains the original
  // transaction locks and the second is observed waiting on that backend.
  await q('delete from icash_operational_contacts where account_id=$1',[account]);
  await a.query('begin');await a.query('set local role service_role');
  await a.query('select icash_queue_voice_jobs()');
  queued();await blocked('Competing queue');
  await a.query('commit');await pending;pending=null;
  assert.equal(await count(),2,'Competing queues project one contact per channel');
  assert.equal((await one('select count(*)::int n from (select account_id,screening_id,phone,channel,count(*) from icash_operational_contacts group by 1,2,3,4 having count(*)>1) duplicates')).n,0);

  // Pause commits after the queue has entered but before it obtains its budget
  // row. The unchanged preparation function must see Pause and produce nothing.
  await q('delete from icash_operational_contacts where account_id=$1',[account]);
  await lockBudget();queued();await blocked('Late Pause queue');
  await a.query('update icash_accounts set bot_paused=true where id=$1',[account]);
  await a.query('commit');await pending;pending=null;
  assert.equal(await count(),0,'Late Pause excludes fresh projections');
  await q('update icash_accounts set bot_paused=false where id=$1',[account]);
  await b.query('select icash_queue_voice_jobs()');assert.equal(await count(),2);

  const contact=await one("select id,dnc_receipt_id from icash_operational_contacts where account_id=$1 and channel='voice'",[account]);
  const currentSql="select icash_operational_contact_current($1,$2,'voice',false) allowed";
  assert.equal((await b.query(currentSql,[account,contact.id])).rows[0].allowed,true);
  await lockBudget();start(currentSql,[account,contact.id]);await blocked('Final admission after revocation');
  await a.query('update icash_dnc_verification_receipts set revoked_at=clock_timestamp() where id=$1',[contact.dnc_receipt_id]);
  await a.query('commit');assert.equal((await pending).rows[0].allowed,false);pending=null;
  await b.query('select icash_queue_voice_jobs()');assert.equal(await count(),2);
  assert.deepEqual(await snapshot(),immutableBefore,'No money, provider, source or ingestion evidence changes');
  const receiptsAfter=(await q('select to_jsonb(r) value from icash_dnc_verification_receipts r order by id')).rows;
  assert.equal(receiptsAfter.length,receiptsBefore.length);
  for(let i=0;i<receiptsAfter.length;i++){
   const before=receiptsBefore[i].value,after=receiptsAfter[i].value;
   if(after.id===contact.dnc_receipt_id){assert.equal(before.revoked_at,null);assert(after.revoked_at);}
   else assert.equal(after.revoked_at,before.revoked_at);
   assert.deepEqual({...after,revoked_at:null},{...before,revoked_at:null},'Only deliberate fixture revocation changes receipt');
  }
  assert.equal((await one('select count(*)::int n from icash_voice_jobs')).n,0,'No dispatch/provider job is created');
  console.log('PASS native PostgreSQL: observed queue/budget waits, competing projections, late Pause, late receipt revocation and unchanged final admission; no duplicates, deadlocks, money or provider evidence changes.');
 }finally{
  await a.query('rollback').catch(()=>{});
  if(pending)await pending.catch(()=>{});
  await Promise.all([a.end(),b.end()]);
 }
}
