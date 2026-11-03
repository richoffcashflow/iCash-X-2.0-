import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=new PGlite(),q=(sql,args=[])=>pg.query(sql,args),v=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0]??{})[0];
const walk=n=>[n,...(n.Plans??[]).flatMap(walk)];
const source=JSON.parse(read('tests/fixtures/text-message-thread-scheduler-before.json')).definition;
const start=source.indexOf(' with candidates as materialized ('),end=source.indexOf(' if not found',start);
assert.ok(start>0&&end>start);
// Only the PL/pgSQL INTO target is removed. All original global exclusions,
// final helper, ordering, LIMIT and SKIP LOCKED remain exactly as captured.
const selection=source.slice(start,end).replace('select ordered.* into thread','select ordered.*').trim();
const history=`select md5(string_agg(v,',' order by v)) from (
 select to_jsonb(m)::text v from public.icash_text_messages m union all
 select to_jsonb(t)::text from public.icash_text_threads t union all
 select to_jsonb(w)::text from public.icash_wallets w) h`;
try{
 await pg.exec(read('tests/fixtures/text-message-thread-index.sql'));await pg.exec(source);
 const definition=await v("select pg_get_functiondef('public.icash_next_before_sms_inbound_campaign()'::regprocedure)");
 const before=(await q(selection)).rows,hash=await v(history);
 assert.equal(before.length,1);
 const migration=read('config/text-message-thread-index.sql');
 const versions=readdirSync(new URL('../supabase/migrations',import.meta.url)).filter(x=>x.endsWith('_text_message_thread_index.sql'));
 assert.equal(versions.length,1);assert.equal(read('supabase/migrations/'+versions[0]),migration);
 await pg.exec('set plan_cache_mode=force_generic_plan;prepare original_selection as '+selection);
 assert.deepEqual((await q('execute original_selection')).rows,before);
 const beforePlan=(await v('explain(analyze,buffers,format json) execute original_selection'))[0];
 await pg.exec(migration);await pg.exec('analyze public.icash_text_messages');
 const afterPlan=(await v('explain(analyze,buffers,format json) execute original_selection'))[0];
 assert.ok(walk(afterPlan.Plan).some(n=>n['Index Name']==='icash_text_messages_thread_lookup'));
 assert.deepEqual((await q('execute original_selection')).rows,before);
 assert.equal(await v(history),hash);
 assert.equal(await v("select pg_get_functiondef('public.icash_next_before_sms_inbound_campaign()'::regprocedure)"),definition);
 assert.ok(afterPlan.Plan['Shared Hit Blocks']*2<beforePlan.Plan['Shared Hit Blocks'],JSON.stringify({before:beforePlan.Plan['Shared Hit Blocks'],after:afterPlan.Plan['Shared Hit Blocks']}));
 const selected=before[0],other=await v('select id from public.icash_accounts where id<>$1 order by id limit 1',[selected.account_id]);
 for(const account of [selected.account_id,other,null])for(const state of ['ready','dispatching','accepted','delivered','needs_review','received','cancelled']){
  await pg.exec('begin');
  try{
   await q("insert into public.icash_text_messages values(md5('late-evidence')::uuid,$1,$2,now(),$3,'outgoing','preserved late evidence')",[account,selected.id,state]);
   assert.notEqual((await q('execute original_selection')).rows[0]?.id,selected.id,`${account}/${state} existing history must exclude global thread`);
   await pg.exec("update public.icash_text_messages set state='delivered',direction='incoming' where id=md5('late-evidence')::uuid");
   assert.notEqual((await q('execute original_selection')).rows[0]?.id,selected.id,'Terminal/incoming changes must never reopen historical outreach');
  }finally{await pg.exec('rollback');}
 }
 assert.equal(await v(history),hash);assert.deepEqual((await q('execute original_selection')).rows,before);
 console.log(`PASS text thread index: exact scheduler SELECT/locks unchanged, every historical state and inconsistent-account message excludes thread, prepared plan invalidation/late evidence, immutable messages/threads/wallets; shared hits ${beforePlan.Plan['Shared Hit Blocks']} -> ${afterPlan.Plan['Shared Hit Blocks']}. No providers.`);
}finally{await pg.close();}
