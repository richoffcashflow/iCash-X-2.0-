import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {installUsageResearchFixture,migration,migrationPath,read,value,signature,definition,evidence,sources,
 account,user,rate,uid,context,seedResearch,instrumentScoring,resetScoring,scoringCalls} from './helpers/usage-context-research-precheck-fixture.mjs';
const p=await PGlite.create(),v=(s,a=[])=>value(p,s,a);
const isolated=async fn=>{await p.exec('begin');try{await fn();}finally{await p.exec('rollback');}};
try{
 assert.equal(migration,read(migrationPath));await installUsageResearchFixture(p);await seedResearch(p,30);
 const before=await definition(p),beforeEvidence=await evidence(p);
 for(const change of [
  'grant execute on function public.icash_usage_loop_context(uuid,uuid) to authenticated',
  'alter function public.icash_usage_loop_context(uuid,uuid) security definer',
  'alter function public.icash_usage_loop_context(uuid,uuid) stable',
  'alter function public.icash_usage_loop_context(uuid,uuid) parallel safe',
  'alter function public.icash_usage_loop_context(uuid,uuid) set search_path=public',
  'alter function public.icash_usage_loop_context(uuid,uuid) owner to service_role',
  before.replace('begin\n','begin\n -- synthetic source drift\n'),
 ]){
  await p.exec('begin');await p.exec(change);await assert.rejects(p.exec(migration),/Usage research precheck/);
  await p.exec('rollback');assert.equal(await definition(p),before);
 }
 await p.exec('begin');await p.exec(migration);await assert.rejects(p.exec('select 1/0 as synthetic_ledger_failure'),/division by zero/);
 await p.exec('rollback');assert.equal(await definition(p),before);
 await p.exec('begin');await assert.rejects(p.exec(migration.replace('fc24c125163489d40d275e0b158b6455','00000000000000000000000000000000')),/Usage research precheck result/);
 await p.exec('rollback');assert.equal(await definition(p),before);
 await p.exec('begin;'+migration+'commit;');const after=await definition(p),afterHash=createHash('md5').update(after).digest('hex');
 assert.deepEqual(await evidence(p),beforeEvidence);
 const needle=' if work is null then\n  candidate:=public.icash_enrichment_candidate(p_account);';
 assert.equal(before.split(needle).length,2);
 const prefix=after.slice(before.indexOf(needle),after.indexOf('  candidate:=public.icash_enrichment_candidate(p_account);'));
 assert.equal(after.replace(prefix,' if work is null then\n'),before,'Only a necessary precheck is added; all post-selection validation and report fields stay byte-identical');
 for(const s of sources.filter(s=>s.signature!=='icash_usage_loop_context(uuid,uuid)')){
  assert.equal(await v('select pg_get_functiondef($1::regprocedure)',[s.signature]),s.definition,'Actual selector, opportunity/ranker/market/buyer-demand chain stays unchanged');
 }
 await instrumentScoring(p);
 let comparisons=0;
 const cases=[
  ['eligible','',30],
  ['disabled','update public.icash_discovery_configs set enabled=false',30],
  ['null enabled','update public.icash_discovery_configs set enabled=null',30],
  ['manual scheduling','update public.icash_discovery_configs set auto_enabled=false',30],
  ['null automatic','update public.icash_discovery_configs set auto_enabled=null',30],
  ['contacts off','update public.icash_discovery_configs set contacts_enabled=false',30],
  ['null contacts','update public.icash_discovery_configs set contacts_enabled=null',30],
  ['expired data','update public.icash_discovery_configs set data_rights_until=now()',30],
  ['unknown data','update public.icash_discovery_configs set data_rights_until=null',30],
  ['rate disabled','update public.icash_operation_rates set enabled=false',30],
  ['unknown rate enabled','update public.icash_operation_rates set enabled=null',30],
  ['rate future',"update public.icash_operation_rates set verified_at=now()+interval '1 second'",30],
  ['rate unverified','update public.icash_operation_rates set verified_at=null',30],
  ['rate expired','update public.icash_operation_rates set expires_at=now()',30],
  ['unknown rate expiry','update public.icash_operation_rates set expires_at=null',30],
  ['wrong operation',"update public.icash_operation_rates set operation='property_search'",30],
  ['unknown operation','update public.icash_operation_rates set operation=null',30],
  ['missing rate','delete from public.icash_operation_rates',0],
  ['unconfigured rate','update public.icash_discovery_configs set contact_rate_id=null',0],
  ['missing config','delete from public.icash_discovery_configs',0],
 ];
 for(const [label,change,oldCalls] of cases)await isolated(async()=>{
  if(change)await p.exec(change);const untouched=await evidence(p);
  await resetScoring(p);const oldResult=await context(p,'fixture_usage_context_before');
  assert.equal(await scoringCalls(p),oldCalls,label+' baseline actual scoring calls');
  await resetScoring(p);const newResult=await context(p);
  assert.deepEqual(newResult,oldResult,label+' complete report equality including nulls');comparisons++;
  assert.equal(await scoringCalls(p),label==='eligible'?30:0,label+' avoids only irrelevant ranking');
  assert.deepEqual(await evidence(p),untouched,label+' never mutates evidence or creates work');
 });
 const unchangedCases=[
  ['account Pause','update public.icash_accounts set bot_paused=true'],
  ['membership missing','update public.fixture_gates set member=false'],
  ['identity missing','delete from public.icash_customer_identities'],
  ['billing hold',`insert into public.icash_billing_reviews(account_id) values('${account}')`],
  ['stale analysis',"update public.icash_screening_jobs set completed_at=now()-interval '25 hours'"],
  ['financially ineligible',`update public.icash_screening_jobs set result=jsonb_set(result,'{financialCheck,status}','"rejected"')`],
  ['unknown financial state',`update public.icash_screening_jobs set result=result-'financialCheck'`],
  ['practice',`update public.icash_screening_jobs set snapshot=snapshot||' {"practice":true}'::jsonb`],
  ['unknown property identity',`update public.icash_screening_jobs set result=jsonb_set(result,'{property}','{}')`],
  ['manual property',`insert into public.icash_property_controls select account_id,snapshot->>'propertyId',true from public.icash_screening_jobs`],
  ['unknown original operation',`insert into public.icash_operation_spend select account_id,'owners:'||account_id||':'||id,'dispatched' from public.icash_screening_jobs`],
  ['open handoff',`insert into public.icash_handoffs select account_id,id,'open' from public.icash_screening_jobs`],
  ['cancelled deal',`insert into public.icash_deal_files(id,account_id,screening_id,stage) select id,account_id,id,'cancelled' from public.icash_screening_jobs`],
 ];
 for(const [label,change] of unchangedCases)await isolated(async()=>{
  await p.exec(change);const untouched=await evidence(p);
  assert.deepEqual(await context(p),await context(p,'fixture_usage_context_before'),label+' complete report unchanged');comparisons++;
  assert.deepEqual(await evidence(p),untouched);
 });
 // A ready SMS takes priority and retains its complete report/price. Neither
 // context may enter research ranking, even with a rejected research config.
 await isolated(async()=>{
  await p.query("insert into public.icash_operation_rates values($1,'sms_send',true,now()-interval '1 day',now()+interval '1 day',1)",[uid(850001)]);
  await p.query("insert into public.icash_deal_files(id,account_id,screening_id,stage) values($1,$2,$3,'under_contract')",[uid(850002),account,uid(840001)]);
  await p.query("insert into public.icash_text_threads(id,account_id,deal_id,party,recipient,sms_rate_id) values($1,$2,$3,'seller','+12145550100',$4)",[uid(850003),account,uid(850002),uid(850001)]);
  await p.query("insert into public.icash_text_messages(id,account_id,thread_id,direction,state,body,customer_price_micros) values($1,$2,$3,'outgoing','ready','Synthetic followup',1000000)",[uid(850004),account,uid(850003)]);
  await p.query("insert into public.icash_journey_messages values($1,$2,$3,$4,'Synthetic followup','ready')",[uid(850005),account,uid(850004),uid(850003)]);
  await p.query("insert into public.icash_signing_envelopes(id,account_id,deal_id,kind,state,provider_id) values($1,$2,$3,'purchase','completed','synthetic-original-signature')",[uid(850006),account,uid(850002)]);
  await p.exec('update public.icash_discovery_configs set enabled=false;update public.fixture_gates set vip=true');
  await resetScoring(p);const c=await context(p);
  assert.deepEqual(c,await context(p,'fixture_usage_context_before'));comparisons++;
  assert.equal(c.work.kind,'seller_followup');assert.equal(c.work.estimateCents,70);assert.equal(c.progress.kind,'contract_signed');assert.equal(c.hasDeal,true);
  assert.equal(await scoringCalls(p),0);
 });
 for(const role of ['anon','authenticated'])assert.equal(await v('select has_function_privilege($1,$2,\'execute\')',[role,signature]),false);
 await assert.rejects(v('select public.icash_usage_loop_context($1,$2)',[account,uid(999999)]),/Account ownership required/);
 await p.exec('set role service_role');assert.equal((await context(p)).work.kind,'research');await p.exec('reset role');
 console.log(JSON.stringify({result:'PASS usage context research precheck',afterHash,wholeContextComparisons:comparisons,ineligibleRankingBefore:30,ineligibleRankingAfter:0,eligibleRankingUnchanged:30}));
}catch(e){console.error(e.stack,e.where??'');process.exitCode=1;}finally{await p.close();}
