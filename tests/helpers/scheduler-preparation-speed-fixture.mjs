import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
export async function verifySchedulerPreparationSpeed(f){
 const {pg,q,one,isolated,account,other,screening}=f;
 const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
 const sql=read('config/scheduler-fast-selection.sql');
 const before=JSON.parse(read('tests/fixtures/scheduler-fast-selection-before.json'));
 for(const name of ['icash_project_operational_sms_contacts','icash_owner_sms_quality_current'])await pg.exec(before.find(x=>x.proname===name).definition);
 const definition=(await one("select pg_get_functiondef('icash_prepare_operational_contacts_before_dm_observations(uuid)'::regprocedure) definition")).definition;
 assert.equal(definition,before.find(x=>x.proname==='icash_prepare_operational_contacts_before_dm_observations').definition);
 const signatures=['icash_prepare_operational_contacts_before_dm_observations(uuid)','icash_project_operational_sms_contacts(uuid)','icash_owner_sms_quality_current(uuid,uuid,text)'];
 const metadata=()=>q('select oid,proowner,proacl,provolatile,prosecdef,proconfig from pg_proc where oid in ($1::regprocedure,$2::regprocedure,$3::regprocedure) order by oid',signatures);
 const originalMetadata=(await metadata()).rows;
 // A drifted gate must roll the entire migration back, including the new helper.
 const quality=before.find(x=>x.proname==='icash_owner_sms_quality_current').definition;
 await pg.exec(quality.replace('AS $function$','AS $function$\n-- fixture drift'));
 await assert.rejects(pg.exec(sql),/Scheduler quality prerequisite changed/);await pg.exec('rollback');
 assert.equal((await one("select to_regprocedure('icash_owner_sms_quality_candidate(uuid,uuid,text)') value")).value,null);
 await pg.exec(quality);await pg.exec(sql);
 assert.deepEqual((await metadata()).rows,originalMetadata,'Existing owner, security, volatility, ACL and search path remain exact');
 const migrated=(await one("select pg_get_functiondef('icash_prepare_operational_contacts_before_dm_observations(uuid)'::regprocedure) definition")).definition;
 const original=definition.slice(definition.indexOf('with national_sources'),definition.indexOf('\n loop'));
 const improved=migrated.slice(migrated.indexOf('with national_sources'),migrated.indexOf('\n loop'));
 assert.equal(migrated.slice(migrated.indexOf('\n loop')),definition.slice(definition.indexOf('\n loop')),'Insertion loop is unchanged');
 const projected=(await one("select pg_get_functiondef('icash_project_operational_sms_contacts(uuid)'::regprocedure) definition")).definition;
 const projectionBefore=before.find(x=>x.proname==='icash_project_operational_sms_contacts').definition;
 assert.equal(projected.slice(projected.indexOf('\n loop')),projectionBefore.slice(projectionBefore.indexOf('\n loop')),'Every locked final projection gate is unchanged');
 assert.equal((await one("select pg_get_functiondef('icash_owner_sms_quality_current(uuid,uuid,text)'::regprocedure) definition")).definition,quality,'Original mutating quality validator is unchanged');
 const select=(query,a=account)=>q(query.replaceAll('p_account','$1::uuid'),[a]);
 const bindings=query=>query.slice(0,query.indexOf('), candidates as materialized (')+1)+' select count(*)::int n from national_sources';
 assert.equal((await select(bindings(original))).rows[0].n,1);
 assert.equal((await select(bindings(improved))).rows[0].n,0,'Already prepared exact channels stop before downstream joins');
 for(const [label,change,args] of [
  ['warm',null,[]],
  ['missing voice',"delete from icash_operational_contacts where account_id=$1 and channel='voice'",[account]],
  ['missing SMS',"delete from icash_operational_contacts where account_id=$1 and channel='sms'",[account]],
  ['cold','delete from icash_operational_contacts where account_id=$1',[account]],
  ['different source',"update icash_operational_contacts set source_hash=repeat('0',64) where account_id=$1",[account]],
  ['different phone',"update icash_operational_contacts set phone='+12145550999',contact_key=encode(sha256(convert_to('+12145550999','UTF8')),'hex') where account_id=$1",[account]],
  ['revoked',"update icash_operational_contacts set revoked_at=now() where account_id=$1",[account]],
  ['paused','update icash_accounts set bot_paused=true where id=$1',[account]],
  ['changed saved source',"update icash_owner_contacts set result=result||'{\"changed\":true}' where screening_id=$1",[screening]],
 ])await isolated(async()=>{
  // Synthetic mismatched historical rows only; production provenance remains
  // immutable and this local trigger state rolls back with the scenario.
  if(['different source','different phone'].includes(label))await pg.exec('alter table icash_operational_contacts disable trigger user');
  if(label==='changed saved source')await pg.exec('alter table icash_owner_contacts disable trigger user');
  if(change)await q(change,args);
  for(const scope of [account,other,null])assert.deepEqual((await select(improved,scope)).rows,(await select(original,scope)).rows,label+' original rows/order/scope');
 });
 await pg.exec('set plan_cache_mode=force_generic_plan');
 await pg.exec('prepare speed_old(uuid) as '+original.replaceAll('p_account','$1')+';prepare speed_new(uuid) as '+improved.replaceAll('p_account','$1'));
 assert.deepEqual((await q(`execute speed_new('${account}')`)).rows,(await q(`execute speed_old('${account}')`)).rows);
 await pg.exec('deallocate speed_old;deallocate speed_new;reset plan_cache_mode');
 console.log('Scheduler preparation: exact cold/warm/missing-channel/source/account equivalence, generic plan, drift rollback, unchanged insertion/final gates and security metadata.');
}
