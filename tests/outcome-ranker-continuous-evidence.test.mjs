import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {trainOutcomeRanker} from '../lib/outcome-ranker.ts';
import {setupSql,seedSql,patch} from './helpers/ranker-rotation-fixture.mjs';
const db=new PGlite(),q=(sql,args=[])=>db.query(sql,args),val=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0]??{})[0];
const claim=()=>val('select icash_claim_ranker_training()');
const release=()=>db.exec('update icash_ranker_private.settings set lease_until=null;');
const keyList=result=>result.samples.map(x=>x.property);
try{
 await db.exec('create role anon;create role authenticated;create role service_role;');
 await db.exec(setupSql);await db.exec(seedSql);
 // Reproduce the live failure: unchanged hash caps permanently omit evidence,
 // even when its completed label becomes positive between training runs.
 const old=await claim();await release();assert.deepEqual(keyList(await claim()),keyList(old));
 const excluded=await val(`select property_key from icash_ranker_private.samples
  where property_key<>all($1::text[]) order by property_key limit 1`,[keyList(old)]);
 await q('update icash_ranker_private.samples set interest=1 where property_key=$1',[excluded]);
 await release();assert(!keyList(await claim()).includes(excluded),'Old export indefinitely omits an unchanged eligible positive');
 await release();
 const original=await val(`select md5(jsonb_agg(to_jsonb(s) order by screening_id)::text) from icash_ranker_private.samples s`);
 const finish=await val("select pg_get_functiondef('icash_finish_ranker_training(uuid,jsonb,integer)'::regprocedure)");
 await db.exec(patch);
 assert.equal(await val(`select md5(jsonb_agg(to_jsonb(s)-'last_export_sequence' order by screening_id)::text) from icash_ranker_private.samples s`),original,'Original feature, label, model and exposure evidence is unchanged');
 assert.equal(await val("select pg_get_functiondef('icash_finish_ranker_training(uuid,jsonb,integer)'::regprocedure)"),finish,'Qualification and saved result authority are byte-for-byte unchanged');
 assert.equal(await val("select has_function_privilege('authenticated','icash_claim_ranker_training()','execute')"),false);
 const first=await claim(),seen=new Set(keyList(first));
 assert.deepEqual(first.sampling,{version:'age-fair-v2',sequence:1,eligible:12800,selected:5000,newlyCovered:5000,remainingUnseen:7800});
 assert.equal(await claim(),null,'Concurrent claim cannot rotate or consume the live lease');
 assert.equal(await val('select export_sequence from icash_ranker_private.settings'),1);
 const validate=result=>{
  assert.equal(result.samples.length,5000);assert.equal(new Set(keyList(result)).size,5000);
  const bands=[0,0,0,0],accounts=new Map();
  for(const row of result.samples){const age=(Date.parse(result.asOf)-Date.parse(row.exposedAt))/86400000;bands[age>=120?0:age>=60?1:age>=30?2:3]++;accounts.set(row.account,(accounts.get(row.account)??0)+1);}
  assert.deepEqual(bands,[1250,1250,1250,1250]);assert(Math.max(...accounts.values())<=200);
  assert.equal(trainOutcomeRanker(result.samples,result.asOf).status,'collecting','Rotation cannot invent sufficient positives or force model activation');
 };
 validate(first);
 await release();const second=await claim();validate(second);keyList(second).forEach(x=>seen.add(x));
 assert.equal(second.sampling.newlyCovered,5000);assert.equal(second.sampling.remainingUnseen,2800);
 await release();const third=await claim();validate(third);keyList(third).forEach(x=>seen.add(x));
 assert.equal(third.sampling.newlyCovered,2800);assert.equal(third.sampling.remainingUnseen,0);
 assert.equal(seen.size,12800);assert(seen.has(excluded),'The previously omitted real label receives a turn without label-based selection');
 assert.equal(await val('select count(*)::int from icash_ranker_private.samples where last_export_sequence=0'),0);
 // Both caps and rotation ignore label values. Restore only fixture metadata,
 // invert every label, and verify the same first selection exactly.
 await db.exec('update icash_ranker_private.samples set last_export_sequence=0,interest=1-interest;update icash_ranker_private.settings set export_sequence=0,lease_until=null;');
 assert.deepEqual(keyList(await claim()),keyList(first),'No class balancing or positive oversampling');
 // The service can be deployed before the DB change and vice versa. A successful
 // original receipt starts the new 12-minute cadence, with the same 3-minute lease.
 const active=await val('select lease_token from icash_ranker_private.settings');
 assert.equal(await val('select icash_finish_ranker_training($1,$2,1)',[active,{status:'collecting',model:null,reason:'fixture',metrics:{}}]),true);
 assert.equal(await claim(),null);
 await db.exec("update icash_ranker_private.settings set last_trained_at=now()-interval '13 minutes';");
 assert((await claim()).token,'The next bounded claim is eligible before the former 55-minute delay');
 // Uneven ages and one large account: unused bands yield capacity, the account
 // cap remains200, and later arrivals cannot jump older never-exported rows.
 await db.exec(`delete from icash_ranker_private.samples where exposed_at<now()-interval '30 days';
  update icash_ranker_private.samples set last_export_sequence=0;
  update icash_ranker_private.settings set export_sequence=0,last_trained_at=null,lease_until=null;
  insert into icash_screening_jobs(id,account_id,state)
   select md5('large-'||n)::uuid,md5('rotation-account-1')::uuid,'pending' from generate_series(1,720)n;
  insert into icash_ranker_private.samples(screening_id,account_id,property_key,features,observed_at,captured_at,baseline,cohort,exposed_at,interest,refreshed_at)
   select md5('large-'||n)::uuid,md5('rotation-account-1')::uuid,'large-'||n,array_fill(0::double precision,array[12]),
    now()-interval '230 days',now()-interval '229 days',0.5,'collecting',now()-interval '5 days',0,now()
   from generate_series(1,720)n;`);
 const largeAccount=await val("select md5(md5('rotation-account-1')::uuid::text)");
 const oldLarge=new Set(await val("select jsonb_agg(property_key) from icash_ranker_private.samples where account_id=md5('rotation-account-1')::uuid"));
 const seenLarge=new Set();
 for(let round=0;round<4;round++){
  await release();const exported=await claim(),large=exported.samples.filter(s=>s.account===largeAccount);
  assert.equal(large.length,200);assert.equal(exported.samples.length,3320,'Empty age bands do not waste capacity, but the account cap remains authoritative');
  large.forEach(s=>{if(oldLarge.has(s.property))seenLarge.add(s.property);});
  if(round<3)await db.exec(`insert into icash_screening_jobs(id,account_id,state)
    select md5('arrival-${round}-'||n)::uuid,md5('rotation-account-1')::uuid,'pending' from generate_series(1,50)n;
   insert into icash_ranker_private.samples(screening_id,account_id,property_key,features,observed_at,captured_at,baseline,cohort,exposed_at,interest,refreshed_at)
    select md5('arrival-${round}-'||n)::uuid,md5('rotation-account-1')::uuid,'arrival-${round}-'||n,array_fill(0::double precision,array[12]),
     now()-interval '10 days',now()-interval '6 days',0.5,'collecting',now()-interval '5 days',0,now()
    from generate_series(1,50)n;`);
 }
 assert.equal(seenLarge.size,800,'All older eligible rows are seen despite continued later arrivals');
 await release();await db.exec("update icash_ranker_private.samples set refreshed_at=now()-interval '3 hours';");
 const stale=await claim();assert.deepEqual(stale.samples,[]);assert.equal(stale.sampling.eligible,0,'Rotation never substitutes stale labels');
 const migrations=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(n=>n.endsWith('_ranker_continuous_evidence.sql'));
 assert.equal(migrations.length,1);assert.equal(readFileSync(new URL('../supabase/migrations/'+migrations[0],import.meta.url),'utf8'),patch);
 console.log('Ranker continuous evidence: reproduced omitted positives, unbiased complete rotating coverage, age/account/global caps, unchanged qualification, maturity/freshness and bounded faster cadence passed.');
}finally{await db.close();}
