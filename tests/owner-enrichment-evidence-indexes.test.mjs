import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8'),pg=new PGlite();
const q=(s,a=[])=>pg.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const account='00000000-0000-4000-8000-000000000001',screening='00000000-0000-4000-8000-000000000002',op=`owners:${account}:${screening}`;
const available=()=>v('select icash_owner_enrichment_unstarted($1,$2,$3)',[account,screening,op]);
try{
 await pg.exec(read('tests/fixtures/owner-evidence-indexes.sql'));
 const source=read('config/owner-enrichment-deferral.sql');
 await pg.exec(source.slice(source.indexOf('create function public.icash_owner_enrichment_unstarted('),source.indexOf('create function public.icash_owner_enrichment_retry_safe(')));
 await pg.exec('alter function public.icash_owner_enrichment_unstarted(uuid,uuid,text) rename to fixture_original_unstarted');
 // Retain the exact original definition for the guarded migration and comparison.
 await pg.exec(source.slice(source.indexOf('create function public.icash_owner_enrichment_unstarted('),source.indexOf('create function public.icash_owner_enrichment_retry_safe(')));
 await pg.exec('revoke all on function public.icash_owner_enrichment_unstarted(uuid,uuid,text) from public');
 await pg.exec(read('config/owner-enrichment-evidence-indexes.sql'));
 assert.equal(await available(),true);
 const suffixes=['',':',':receipt',':0',':%',':_',':\\',':é',':🏠',':\n',':\uffff',';', ';receipt','0','/','_','-receipt'];
 for(const field of ['event_key','source_ref'])for(const suffix of suffixes){
  const key=(field==='source_ref'?'dealmachine:owners:':'')+op+suffix;
  await pg.exec('truncate icash_cost_observations');
  await q(`insert into icash_cost_observations(event_key,source_ref) values($1,$2)`,field==='event_key'?[key,null]:['independent-receipt',key]);
  assert.equal(await available(),await v('select fixture_original_unstarted($1,$2,$3)',[account,screening,op]),`${field} boundary ${JSON.stringify(suffix)}`);
  assert.equal(await available(),!(suffix===''||suffix.startsWith(':')));
 }
 await pg.exec('truncate icash_cost_observations');
 for(const table of ['icash_operation_spend','icash_credit_reservations','icash_cost_manifests','icash_private.provider_costs']){
  await q(`insert into ${table}(operation_key) values($1)`,[op]);assert.equal(await available(),false,table);await pg.exec(`truncate ${table}`);
 }
 for(const [table,columns,args] of [
  ['icash_owner_contacts','screening_id',[screening]],['icash_owner_contacts','operation_key',[op]],
  ['icash_live_conversations','operation_key',[op]],['icash_live_conversations','account_id,screening_id',[account,screening]],
  ['icash_operational_contacts','account_id,screening_id',[account,screening]],['icash_contact_permissions','account_id,screening_id',[account,screening]],
 ]){await q(`insert into ${table}(${columns}) values(${args.map((_,i)=>'$'+(i+1)).join(',')})`,args);assert.equal(await available(),false,table);await pg.exec(`truncate ${table}`);}
 for(const args of [[null,screening,op],[account,null,op],[account,screening,'owners:other'],[account,screening,null]])assert.notEqual(await v('select icash_owner_enrichment_unstarted($1,$2,$3)',args),true);
 assert.equal(await v("select has_function_privilege('public','public.icash_owner_enrichment_unstarted(uuid,uuid,text)','execute')"),false,'Replacement preserves the private ACL');
 await pg.exec("insert into icash_cost_observations(event_key,source_ref) select 'unrelated:'||g,'provider:unrelated:'||g from generate_series(1,50000) g;analyze icash_cost_observations;set plan_cache_mode=force_generic_plan");
 for(const [field,prefix] of [['event_key',op],['source_ref','dealmachine:owners:'+op]]){
  const name=field==='event_key'?'event':'source';
  await pg.exec(`prepare ${name}(text) as select 1 from icash_cost_observations where ${field} collate "C">=($1||':') collate "C" and ${field} collate "C"<($1||';') collate "C"`);
  const plan=await v(`explain(format json) execute ${name}('${prefix}')`);
  assert.match(JSON.stringify(plan),new RegExp('icash_cost_observation_'+name+'_prefix'),'A generic parameterized plan uses the index');
 }
 assert.equal(await available(),true);
 assert.equal(await v('select count(*)::int from icash_cost_observations'),50000,'Checks never mutate evidence');
 console.log('PASS indexed owner evidence: exact and Unicode/punctuation suffix equivalence, every original hold, private ACL, and generic indexed plans across 50,000 receipts.');
}finally{await pg.close();}
