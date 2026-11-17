import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {installTitleTaskFixture,titleTaskMigration,cancelledTitleDeadlines} from './fixtures/title-task-delivery-fixture.mjs';
const db=new PGlite(),row=async(q,args=[])=>(await db.query(q,args)).rows[0];
const tasks=async()=>(await db.query('select * from public.icash_title_tasks order by id')).rows;
async function rejects(mutate,pattern=/requires an empty title lifecycle/){
 await db.exec('begin');
 try{await mutate();await assert.rejects(db.exec(titleTaskMigration()),pattern);}finally{await db.exec('rollback');}
 assert.equal((await row("select to_regnamespace('icash_title_task_delivery_private') value")).value,null);
}
try{
 await installTitleTaskFixture(db);
 const a=await cancelledTitleDeadlines(db),b=await cancelledTitleDeadlines(db),original=await tasks();
 assert.equal(original.length,4);
 assert.equal((await row('select count(*)::int n from public.icash_title_requests')).n,0);
 const task=a.tasks[0],seed=JSON.parse(readFileSync('tests/fixtures/title-deadline-seed-predecessor.json','utf8'))[0];
 assert.equal((await row("select md5(pg_get_functiondef('public.icash_seed_contract_deadlines(uuid)'::regprocedure)) hash")).hash,seed.source_md5);
 // The real previous claims cannot admit these rows. Even an erroneously issued
 // deadline is rejected by kind, before any provider operation can exist.
 for(const issued of [false,true]){
  await db.exec('begin');
  if(issued)await db.query("update public.icash_title_tasks set state='scheduled',email_state='issued' where id=$1",[task.id]);
  assert.equal((await row('select public.icash_claim_title_followup($1,$2) value',[a.account,task.id])).value,null);
  assert.equal((await row('select public.icash_claim_title_update($1,$2,$3) value',[a.account,task.id,task.payload])).value,null);
  assert.equal((await row('select count(*)::int n from public.icash_operation_spend')).n,0);
  await db.exec('rollback');
 }
 for(const [column,values] of Object.entries({kind:['follow_up','document_update','reply_review'],state:['scheduled','needs_review','done','dismissed'],email_state:['issued','dispatching','sent','needs_review'],email_provider_id:['original-provider'],source_key:['different-deadline-source']})){
  for(const value of values)await rejects(()=>db.query(`update public.icash_title_tasks set ${column}=$2 where id=$1`,[task.id,value]));
 }
 for(const payload of [null,{}, {...task.payload,type:'assignment'},{...task.payload,deadline:'other'},{...task.payload,envelopeId:b.purchase}]){
  await rejects(()=>db.query('update public.icash_title_tasks set payload=$2::jsonb where id=$1',[task.id,JSON.stringify(payload)]));
 }
 for(const [column,value] of [['account_id',b.account],['deal_id',b.deal],['kind','assignment'],['state','voided'],['test_mode',true]]){
  await rejects(()=>db.query(`update public.icash_signing_envelopes set ${column}=$2 where id=$1`,[a.purchase,value]));
 }
 await rejects(async()=>{
  const rate=(await row("insert into public.icash_operation_rates values(gen_random_uuid(),'title_email',true,now()+interval '1 day') returning id")).id;
  await db.query("insert into public.icash_operation_spend(operation_key,account_id,rate_id,state,dispatched_at,permission_until) values($1,$2,$3,'dispatched',now(),now()+interval '1 day')",['title-followup:'+task.id,a.account,rate]);
 });
 await rejects(()=>db.exec('grant execute on function public.icash_seed_contract_deadlines(uuid) to authenticated'),/prerequisite changed/);
 await db.exec('begin;'+titleTaskMigration()+'commit;');
 assert.deepEqual(await tasks(),original,'Every deadline row survives installation byte-for-byte as database values');
 assert.equal((await row('select count(*)::int n from public.icash_operation_spend')).n,0);
 assert.equal((await row('select count(*)::int n from icash_title_task_delivery_private.admissions')).n,0);
 for(const c of [a,b])for(const t of c.tasks){
  assert.equal((await row('select public.icash_title_task_delivery_snapshot($1,$2) value',[c.account,t.id])).value,null);
  assert.equal((await row('select public.icash_claim_title_followup($1,$2) value',[c.account,t.id])).value,null);
  assert.equal((await row('select public.icash_claim_title_update($1,$2,$3) value',[c.account,t.id,t.payload])).value,null);
  assert.equal((await row('select public.icash_finish_title_task_delivery($1,$2,$3) value',[c.account,t.id,'unowned-provider'])).value,false);
 }
 assert.deepEqual(await tasks(),original);
 console.log('PASS title cutover: exact actual-seeded cancelled deadlines preserved, old/current claims refuse them, all active/transport/source/operation counterexamples hold, no original evidence fabricated.');
}catch(error){console.error(error.message,error.code,error.where);process.exitCode=1;}finally{await db.close();}
