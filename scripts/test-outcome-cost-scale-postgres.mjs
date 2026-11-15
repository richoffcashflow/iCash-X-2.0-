// Bounded native SQL scale check against a fixed disposable localhost database.
// No application credentials, provider requests or paid work are accepted.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {assertDisposablePostgresTarget} from '../tests/helpers/disposable-postgres-target.mjs';
const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg');
const cfg={host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:'icash_reliability',connectionTimeoutMillis:5000};
const c=new Client({...cfg,application_name:'outcome-cost-scale'});await c.connect();
const account='00000000-0000-4000-8000-000000000003';
const value=async(sql,args=[])=>Object.values((await c.query(sql,args)).rows[0]??{})[0];
try{
 await assertDisposablePostgresTarget(c);
 // Bootstrap the real integration and its full source graph through the native
 // scenario suite, which owns only this same fixed local database.
 process.env.ICASH_OUTCOME_NATIVE='1';
 process.env.ICASH_OUTCOME_SCALE_BOOTSTRAP='1';
 await import('../tests/outcome-window-cost-learning.test.mjs');
 assert(!process.exitCode,'Native scenario fixture must pass before scale measurements');
 for(const [file,signature] of [['config/outcome-cost-source-planning.sql','icash_learning_private.outcome_cost_sources(uuid)'],['config/outcome-window-cost-collector.sql','icash_learning_private.outcome_window_cost_batch(uuid,jsonb)']]){
  const expected=readFileSync(new URL('../'+file,import.meta.url),'utf8').match(/as \$function\$([\s\S]*?)\$function\$;/)?.[1];
  assert(expected);assert.equal(await value('select prosrc from pg_proc where oid=$1::regprocedure',[signature]),expected,'Measure the real production function, never a fixture counter wrapper');
 }
 await c.query("set statement_timeout='20s';set track_functions='all';set jit=off;");
 await c.query(`
 insert into icash_accounts(id,owner_user_id) values('${account}','00000000-0000-4000-8000-000000000013');
 insert into icash_screening_jobs(id,account_id,event_key,snapshot,created_at)
 select md5('perf-screen-'||n)::uuid,'${account}','perf-source-'||n,jsonb_build_object('propertyId','perf-'||n),now()-interval '90 days' from generate_series(1,500)n;
 insert into icash_deal_files(id,account_id,screening_id,terms) select md5('perf-deal-'||n)::uuid,'${account}',md5('perf-screen-'||n)::uuid,'{}' from generate_series(1,500)n;
 insert into icash_text_threads(id,account_id,deal_id,party,recipient) select md5('perf-thread-'||n)::uuid,'${account}',md5('perf-deal-'||n)::uuid,'buyer','+12125550000' from generate_series(1,500)n;
 insert into icash_text_messages(id,thread_id,account_id,direction,state,provider_id,created_at,last_delivery_at)
 select md5('perf-text-'||n)::uuid,md5('perf-thread-'||n)::uuid,'${account}','outgoing','delivered','perf-message-'||n,now()-interval '35 days',now()-interval '35 days' from generate_series(1,500)n;
 insert into icash_call_recordings(id,account_id,screening_id,party,operation_key,contact_key,created_at,dial_claimed_at,call_context)
 select md5('perf-call-'||n)::uuid,'${account}',md5('perf-screen-'||n)::uuid,'seller','voice:'||md5('perf-call-'||n)::uuid,'perf-contact-'||n,now()-interval '70 days',now()-interval '70 days',jsonb_build_object('strategyKey','cash_interest','prompt','REVIEWED INTEREST QUESTION (shared-v1/reviewed): fixture') from generate_series(1,500)n;
 insert into icash_learning_assignments(account_id,domain,subject,context,market,variant,policy_version,mode,created_at)
 select '${account}','seller_calls',md5('perf-screen-'||n)::uuid||':perf-contact-'||n,'reviewed','*','cash_interest','shared-v1','explore',now()-interval '72 days' from generate_series(1,500)n;
 insert into icash_operation_spend(operation_key,account_id,state,created_at,dispatched_at,settled_at,charged_cents,actual_micros,cost_basis,settlement_evidence)
 select key,'${account}','settled',stamp,stamp,stamp,1,10000,'verified','perf-exact-receipt' from generate_series(1,500)n
 cross join lateral (values('owners:${account}:'||md5('perf-screen-'||n)::uuid,now()-interval '71 days'),('voice:'||md5('perf-call-'||n)::uuid,now()-interval '70 days'),('text:'||md5('perf-text-'||n)::uuid,now()-interval '35 days'))v(key,stamp);
 insert into icash_credit_ledger(account_id,event_key,kind,delta_cents,evidence_ref,created_at) select account_id,'usage:'||operation_key,'usage',-charged_cents,'perf-ledger',dispatched_at from icash_operation_spend where account_id='${account}';
 create index perf_screen_account on icash_screening_jobs(account_id,id);
 create index perf_screen_property on icash_screening_jobs(account_id,(snapshot->>'propertyId'));
 create index perf_deal_account on icash_deal_files(account_id,screening_id,id);
 create index perf_thread_account on icash_text_threads(account_id,deal_id,id);
 create index perf_message_account on icash_text_messages(account_id,thread_id,id);
 create index perf_recording_account on icash_call_recordings(account_id,screening_id);
 create index perf_operation_account on icash_operation_spend(account_id,operation_key);
 create index perf_ledger_account on icash_credit_ledger(account_id,event_key);
 analyze;
 `);
 const timing=async(label,sql,args,expectedCalls)=>{
  await c.query('select pg_stat_reset()');const start=performance.now();const result=(await c.query(sql,args)).rows[0];
  const ms=Math.round(performance.now()-start);await c.query('select pg_stat_force_next_flush()');await c.query('select pg_stat_clear_snapshot()');
  const sourceCalls=Number(await value("select coalesce(sum(calls),0) from pg_stat_user_functions where schemaname='icash_learning_private' and funcname='outcome_cost_sources'"));
  assert.equal(sourceCalls,expectedCalls,label+' must build the graph only once, or never while disabled');
  console.log(JSON.stringify({label,ms,sourceCalls,result}));return result;
 };
 const graph=await timing('source_graph_500_properties_1500_operations','select count(*)::int rows from icash_learning_private.outcome_cost_sources($1)',[account],1);assert.equal(graph.rows,1500);
 for(const n of [100,500]){
  const result=await timing('batch_'+n+'_properties_both_windows',`select count(*)::int windows,bool_and(costs->'complete'='true'::jsonb) complete,
   sum((costs->>'costCents')::integer)::integer total_cents,bool_and((costs->>'costCents')::integer=case window_days when 30 then 2 else 3 end) exact_windows
   from icash_learning_private.outcome_window_cost_batch($1,(select jsonb_agg(jsonb_build_object('property_id','perf-'||n,
    'started_at',(select min(dial_claimed_at) from icash_call_recordings where account_id=$1),'window_days',days))
    from generate_series(1,${n})n cross join unnest(array[30,60])days))`,[account],1);
  assert.deepEqual(result,{windows:2*n,complete:true,total_cents:5*n,exact_windows:true});
 }
 await c.query('update icash_learning_policy_private.outcome_cost_settings set enabled_at=null');
 assert.equal(await value('select icash_outcome_cost_learning_active()'),false);
 await timing('actual_refresh_500_trials_gate_disabled','select icash_refresh_seller_call_learning($1)',[account],0);
 await c.query("update icash_learning_policy_private.settings set release_sha=repeat('a',40)");
 await c.query("select icash_activate_outcome_cost_learning('592171a0-2bb9-484e-8c9a-dd5d2b43b5f7',repeat('a',40),true)");
 assert.equal(await value('select icash_outcome_cost_learning_active()'),true);
 await timing('actual_refresh_500_trials_gate_enabled','select icash_refresh_seller_call_learning($1)',[account],1);
 const row=await value("select to_jsonb(r) from icash_learning_rollups r where account_id=$1 and domain='seller_calls'",[account]);
 assert.deepEqual([row.contract_trials,row.closing_trials,row.outcome_costs.contracts.costCents,row.outcome_costs.closings.costCents,row.outcome_costs.contracts.complete,row.outcome_costs.closings.complete],[500,500,1000,1500,true,true]);
 console.log('PASS native outcome-cost scale: exact 30/60-day totals, 100/500-property batches build one real source graph, disabled refresh builds none. Timings describe this local fixture, not production latency.');
}catch(e){console.error('FAIL native outcome-cost scale:',e.message,e.where??'');process.exitCode=1;}
finally{await c.end();}
