import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const before=JSON.parse(read('tests/fixtures/voice-global-contact-index-before.json'));
const patch=read('config/voice-global-contact-index.sql');
const pg=new PGlite(),q=(s,a=[])=>pg.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const walk=n=>[n,...(n.Plans??[]).flatMap(walk)];
const contactRows=plan=>walk(plan.Plan).filter(n=>n['Relation Name']==='icash_operational_contacts')
 .reduce((n,r)=>n+((r['Actual Rows']??0)+(r['Rows Removed by Filter']??0)+(r['Rows Removed by Index Recheck']??0))*(r['Actual Loops']??0),0);
const definitionQuery=`select jsonb_agg(jsonb_build_object('oid',p.oid,'definition',pg_get_functiondef(p.oid),'owner',p.proowner,
 'acl',p.proacl,'config',p.proconfig,'volatile',p.provolatile,'definer',p.prosecdef) order by p.oid)
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','icash_recording_private') and p.prokind='f'`;
const viewQuery=`select jsonb_build_object('definition',pg_get_viewdef(c.oid),'acl',c.relacl,'owner',c.relowner,'options',c.reloptions)
 from pg_class c where c.oid='public.icash_voice_contact_targets'::regclass`;
async function history(){
 const tables=(await q(`select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','icash_recording_private') and c.relkind='r' order by n.nspname,c.relname`)).rows;
 const values={};
 for(const t of tables)values[t.relname]=await v(`select md5(string_agg(md5(to_jsonb(t)::text),',' order by md5(to_jsonb(t)::text))) from ${t.nspname}.${t.relname} t`);
 return values;
}
async function cases(){
 const rows=(await q('select * from public.fixture_voice_contact_cases order by label')).rows;
 for(const c of rows){
  assert.equal(await v('select exists('+before.busy_query+')',[c.job_id,c.contact_key]),c.expected_busy,c.label+' busy');
  assert.equal(await v('select icash_recording_private.voice_queue_slot_from_snapshot($1,$2,\'{}\')',[c.account_id,c.job_id]),c.expected_slot,c.label+' slot');
 }
 return rows;
}
async function rejects(setup,message){
 await pg.exec('begin;'+setup);
 try{await assert.rejects(pg.exec(patch),message);}finally{await pg.exec('rollback');}
}
try{
 await pg.exec(read('tests/fixtures/voice-global-contact-index.sql'));
 await pg.exec('create view public.icash_voice_contact_targets as '+before.target_view);
 await pg.exec(before.definition);
 await pg.exec(`revoke all on all functions in schema public,icash_recording_private from public,anon,authenticated;
  grant execute on function icash_recording_private.voice_queue_slot_from_snapshot(uuid,uuid,jsonb) to service_role;`);
 assert.equal(await v("select md5(pg_get_functiondef('icash_recording_private.voice_queue_slot_from_snapshot(uuid,uuid,jsonb)'::regprocedure))"),before.definition_md5);
 assert.equal(await v("select md5(pg_get_viewdef('public.icash_voice_contact_targets'::regclass,true))"),before.view_md5);
 const versions=readdirSync(new URL('../supabase/migrations',import.meta.url)).filter(x=>x.endsWith('_voice_global_contact_index.sql'));
 assert.equal(versions.length,1);assert.equal(read('supabase/migrations/'+versions[0]),patch);
 const definitions=await v(definitionQuery),view=await v(viewQuery),evidence=await history();
 const allCases=await cases(),unmatched=allCases.find(c=>c.label==='unmatched');
 await rejects('create index fixture_equivalent on public.icash_operational_contacts(contact_key) where channel=\'voice\';',/equivalent global voice contact index/);
 await rejects('create index fixture_equivalent on public.icash_operational_contacts(contact_key);',/equivalent global voice contact index/);
 await rejects("alter function icash_recording_private.voice_queue_slot_from_snapshot(uuid,uuid,jsonb) immutable;",/Voice slot guard changed/);
 await rejects("create or replace view public.icash_voice_contact_targets as "+before.target_view.replace("WHERE c.channel = 'voice'::text","WHERE c.channel = 'voice'::text AND c.revoked_at IS NULL"),/Voice contact UNION changed/);
 const command=`execute original_guard('${unmatched.job_id}','${unmatched.contact_key}')`;
 const probe=`execute original_probe('${unmatched.job_id}','${unmatched.target_id}','${unmatched.account_id}')`;
 await pg.exec('prepare original_probe(uuid,uuid,uuid) as '+before.performance_query+';');
 await pg.exec('prepare original_guard(uuid,text) as select exists('+before.busy_query+');');
 const plans={};
 for(const mode of ['auto','force_generic_plan']){
  await pg.exec('set plan_cache_mode='+mode);
  plans[mode]={before:(await v('explain(analyze,buffers,format json) '+probe))[0]};
 }
 await pg.exec(patch);await pg.exec('analyze public.icash_operational_contacts');
 for(const mode of ['auto','force_generic_plan']){
  await pg.exec('set plan_cache_mode='+mode);
  const plan=(await v('explain(analyze,buffers,format json) '+probe))[0];plans[mode].after=plan;
  assert.ok(walk(plans[mode].before.Plan).some(n=>n['Relation Name']==='icash_operational_contacts'&&(n['Rows Removed by Filter']??0)>=30000),mode+' baseline scans at least 30k unrelated contacts');
  assert.ok(walk(plan.Plan).some(n=>n['Index Name']==='icash_operational_voice_contact_key'&&n['Actual Loops']>0),mode+' new index executes');
  // The unchanged busy-job join can choose another valid order after indexing.
  // Assert the measured bottleneck's work, not total buffers of unrelated joins.
  assert.ok(contactRows(plan)*2<contactRows(plans[mode].before),JSON.stringify({mode,beforeContacts:contactRows(plans[mode].before),afterContacts:contactRows(plan)}));
  await cases();
 }
 // A reused generic plan sees newly recorded uncertainty and its rollback.
 await pg.exec('begin;set local plan_cache_mode=force_generic_plan;');
 assert.equal(await v(command),false);
 await q("update public.icash_voice_jobs set state='held',outcome='provider_outcome_unknown_no_retry' where id=md5('busy-unmatched')::uuid");
 assert.equal(await v(command),true);
 await pg.exec('rollback');
 assert.equal(await v(command),false);
 assert.deepEqual(await v(definitionQuery),definitions);assert.deepEqual(await v(viewQuery),view);assert.deepEqual(await history(),evidence);
 for(const role of ['anon','authenticated','service_role'])assert.equal(await v("select has_function_privilege($1,'icash_recording_private.voice_queue_slot_from_snapshot(uuid,uuid,jsonb)','execute')",[role]),role==='service_role');
 console.log(JSON.stringify({result:'PASS',scope:'offline PGlite only; no providers',cases:allCases.length,operationalContacts:await v('select count(*) from public.icash_operational_contacts'),voiceJobs:await v('select count(*) from public.icash_voice_jobs'),plans:Object.fromEntries(Object.entries(plans).map(([mode,p])=>[mode,{beforeContactRows:contactRows(p.before),afterContactRows:contactRows(p.after),beforeSharedHits:p.before.Plan['Shared Hit Blocks'],afterSharedHits:p.after.Plan['Shared Hit Blocks'],beforeMs:p.before['Execution Time'],afterMs:p.after['Execution Time']}]))}));
}finally{await pg.close();}
