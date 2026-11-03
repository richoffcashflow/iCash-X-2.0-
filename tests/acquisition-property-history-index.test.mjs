import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=new PGlite(),q=(sql,args=[])=>pg.query(sql,args),v=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0]??{})[0];
const definitions=JSON.parse(read('tests/fixtures/owner-preflight-priority-before.json'));
const walk=n=>[n,...(n.Plans??[]).flatMap(walk)];
try{
 await pg.exec(read('tests/fixtures/opportunity-schema.sql'));
 await pg.exec(read('tests/fixtures/owner-cleanup-ticket-recovery-native.sql'));
 let source=read('config/owner-enrichment-deferral.sql');
 await pg.exec(source.slice(0,source.indexOf('create function public.icash_defer_owner_enrichment'))+'commit;');
 source=read('config/owner-export-preflight.sql');
 await pg.exec(source.slice(0,source.indexOf('create function public.icash_claim_owner_preflight'))+'commit;');
 await pg.exec(read('tests/fixtures/owner-preflight-priority-foundation.sql'));
 for(const name of ['icash_research_private.owner_preflight_cohort(uuid,uuid)','public.icash_owner_preflight_sibling_waiting(uuid,uuid,jsonb,uuid)',
  'public.icash_enrichment_before_prospecting_budget(uuid)','public.icash_enrichment_before_provider_quota(uuid)','public.icash_enrichment_candidate(uuid)','public.icash_next_acquisition()'])await pg.exec(definitions[name]);
 await pg.exec(read('config/owner-preflight-priority.sql'));
 await pg.exec(read('tests/fixtures/acquisition-property-history.sql'));
 const account=await v("select md5('priority-account-1')::uuid"),primary=await v("select md5('priority-screening-1')::uuid");
 const definition=await v("select pg_get_functiondef('icash_enrichment_before_prospecting_budget(uuid)'::regprocedure)");
 const body=definition.split('AS $function$\n')[1].split('\n$function$')[0].replaceAll('p_account',`'${account}'::uuid`);
 const selection=body.slice(0,body.indexOf(' order by public.icash_owner_preflight_due_at'))+' order by s.id';
 const history="select md5(string_agg(v,',' order by v)) from(select to_jsonb(s)::text v from icash_screening_jobs s union all select to_jsonb(o)::text from icash_operation_spend o union all select to_jsonb(c)::text from icash_owner_contacts c) x";
 const before=(await q(selection)).rows,hash=await v(history);
 const migration=read('config/acquisition-property-history-index.sql');
 const versions=readdirSync(new URL('../supabase/migrations',import.meta.url)).filter(x=>x.endsWith('_acquisition_property_history_index.sql'));
 assert.equal(versions.length,1);assert.equal(read('supabase/migrations/'+versions[0]),migration);
 await pg.exec(migration);await pg.exec('analyze icash_screening_jobs');
 assert.deepEqual((await q(selection)).rows,before);
 assert.equal(await v("select pg_get_functiondef('icash_enrichment_before_prospecting_budget(uuid)'::regprocedure)"),definition);
 assert.equal(await v(history),hash);
 const plan=await v('explain(analyze,buffers,format json) '+selection);
 assert.ok(walk(plan[0].Plan).some(n=>n['Index Name']==='icash_screening_property_account'));
 const selected=before.map(r=>r.id);
 for(let n=401;n<=460;n++)assert.ok(!selected.includes(await v("select md5('property-index-history-'||$1::text)::uuid",[n])),'Original contacts and unknown-operation holds retain all matching new screenings');
 for(let n=461;n<=500;n++)assert.ok(selected.includes(await v("select md5('property-index-history-'||$1::text)::uuid",[n])));
 for(let n=1;n<=3;n++)assert.ok(selected.includes(await v("select md5('property-index-null-'||$1::text)::uuid",[n])),'NULL and non-string values retain existing SQL text/equality semantics');
 for(const [owner,kind,expected] of [[1,'operation',false],[2,'operation',true],[1,'contacts',false],[2,'contacts',true]]){
  const other=await v("select md5('priority-account-'||$1::text)::uuid",[owner]);
  await pg.exec('begin;set local plan_cache_mode=force_generic_plan;prepare selected as '+selection);
  try{
   await q(`insert into icash_screening_jobs(id,account_id,event_key,snapshot,state,result,completed_at)
    select md5('late-property-history')::uuid,$1,'late-property-history',snapshot,'complete',result,now()-interval '2 days' from icash_screening_jobs where id=$2`,[other,primary]);
   if(kind==='operation')await q(`insert into icash_operation_spend(operation_key,account_id,rate_id,credit_reservation_id,charge_cap_cents,reserved_micros,state,permission_until)
    values('owners:'||$1||':'||md5('late-property-history')::uuid,$1::uuid,md5('priority-rate-'||$2::text)::uuid,gen_random_uuid(),105,250000,'dispatched',now()-interval '1 day')`,[other,owner]);
   else await q("insert into icash_owner_contacts(screening_id,account_id,operation_key,result) values(md5('late-property-history')::uuid,$1,'late-exact-contact','{}')",[other]);
   assert.equal((await q('execute selected')).rows.some(r=>r.id===primary),expected,`${owner}/${kind}`);
  }finally{await pg.exec('rollback;deallocate selected');}
 }
 assert.equal(await v(history),hash);
 console.log('PASS acquisition property history index: actual candidate guards preserve exact same-property contacts and unknown operations, NULL semantics, account boundaries, immutable history and late evidence with a generic plan.');
}finally{await pg.close();}
