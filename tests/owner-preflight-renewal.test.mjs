import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {activeOwnerExportRequest} from '../lib/owner-active-export.ts';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8'),pg=new PGlite();
const q=(s,a=[])=>pg.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let serial=100;
async function seed(state='ready',overrides={}){
 const n=serial++,account=id(n),screening=id(n+1000),parent=id(n+2000);
 const snapshot={propertyId:'prop_'+n,propertyType:'house',raw:{data:{state:'TX'}}};
 const items=[{screeningId:screening,snapshot,ids:['per_'+n]}],request=activeOwnerExportRequest(['per_'+n]);
 await q('insert into icash_accounts(id) values($1)',[account]);
 await q('insert into icash_discovery_configs(account_id,contact_rate_id) values($1,$2)',[account,id(99)]);
 await q('insert into icash_wallets(account_id) values($1)',[account]);
 await q("insert into icash_screening_jobs(id,account_id,state,snapshot) values($1,$2,'complete',$3)",[screening,account,snapshot]);
 await q(`insert into icash_research_private.owner_export_preflights
 (id,account_id,fingerprint,items,request,state,list_name,list_id,created_at,started_at,checked_at,deleted_at,receipts)
 values($1,$2,md5(jsonb_build_array($3::jsonb,$4::jsonb)::text),$3,$4,$5,'original-fixture',
 $6,now()-$7::interval,now()-$8::interval,case when $9 then now()-$10::interval end,
 case when $11 then now()-interval '40 minutes' end,'{"original":"immutable offline fixture"}')`,
 [parent,account,items,request,state,overrides.knownList===false?null:'"fixture-list"',overrides.age??'2 hours',overrides.started??'1 hour',!['waiting','creating','checking'].includes(state),overrides.checked??'1 hour',overrides.cleaned!==false]);
 const claim=()=>v('select icash_claim_owner_preflight($1,$2,$3)',[account,items,request]);
 return {account,screening,parent,items,request,snapshot,claim};
}
const receipt=raw=>({httpStatus:200,raw,rawText:JSON.stringify(raw)});
const record=(c,step,raw)=>v('select icash_record_owner_preflight($1,$2,$3,$4)',[c.id,c.lease,step,receipt(raw)]);
const digest=parent=>v('select md5(to_jsonb(p)::text) from icash_research_private.owner_export_preflights p where id=$1',[parent]);
try{
 await pg.exec(read('tests/fixtures/owner-preflight-foundation.sql'));
 await pg.exec(read('tests/fixtures/owner-preflight-cohorts.sql'));
 const source=read('config/research-request-efficiency.sql');
 await pg.exec(source.slice(source.indexOf('create function public.icash_owner_batch_candidates('),source.indexOf('create function public.icash_claim_owner_batch(')).replace('create function','create or replace function'));
 for(const file of ['owner-export-preflight','owner-export-preflight-indexing','owner-export-preflight-cohorts'])await pg.exec(read('config/'+file+'.sql'));
 const sql=read('config/owner-preflight-renewal.sql');assert.equal(sql,read('supabase/migrations/20261102223955_owner_preflight_renewal.sql'));await pg.exec(sql);
 await pg.exec(`insert into icash_operation_rates(id) values('${id(99)}');update icash_research_private.owner_export_settings set preflight_enabled=true;`);
 const a=await seed(),before=await digest(a.parent);
 assert.equal((await a.claim()).status,'held','Disabled rollout preserves the original hold');
 await pg.exec('update icash_research_private.owner_export_settings set preflight_renewal_enabled=true');
 const c=await a.claim();assert.equal(c.status,'create');assert.notEqual(c.id,a.parent);assert.equal((await a.claim()).status,'pending');
 assert.equal(await digest(a.parent),before,'Renewal leaves every original field and receipt unchanged');
 assert.deepEqual((await q('select supersedes,generation,receipts,list_id from icash_research_private.owner_export_preflights where id=$1',[c.id])).rows[0],{supersedes:a.parent,generation:2,receipts:{},list_id:null});
 const admit=()=>v('select icash_admit_owner_active_export($1,$2,$3,$4,$5,$6,$7)',[a.account,a.screening,id(5000),a.items,{}, {},a.request]);
 assert.equal(await admit(),'held','A new free claim is not a paid authorization');
 assert.equal(await record(c,'create',{data:{list_id:'new-list',name:c.name,source_type:'people',status:'completed',total_count:1}}),'pending');
 assert.equal((await a.claim()).status,'pending','New list keeps the 90-second indexing allowance');
 await q('update icash_research_private.owner_export_preflights set next_check_at=now() where id=$1',[c.id]);
 const check=await a.claim();assert.equal(check.status,'check');
 assert.equal(await record(check,'baseline',{total_people:1,total_results:1,total_properties:1}),'checking');
 assert.equal(await admit(),'held','Baseline alone is insufficient');
 assert.equal(await record(check,'eligible',{total_people:1,total_results:1,total_properties:1}),'ready');
 assert.equal(await admit(),'claimed','Only fresh exact positive counts reach the existing mock paid boundary');
 assert.equal(await digest(a.parent),before);
 await assert.rejects(q('update icash_research_private.owner_export_preflights set generation=3 where id=$1',[c.id]),/immutable/);
 await assert.rejects(q('update icash_research_private.owner_export_preflights set supersedes=null where id=$1',[c.id]),/immutable/);
 await assert.rejects(q('delete from icash_research_private.owner_export_preflights where id=$1',[a.parent]),/immutable/);

 for(const [state,options,expected] of [
  ['ready',{checked:'5 minutes'},'ready'],['ready',{cleaned:false},'held'],
  ['empty',{age:'2 hours'},'empty'],['empty',{age:'25 hours'},'create'],
  ['waiting',{},'create'],['held',{},'create'],['creating',{},'create'],['checking',{},'create'],
  ['held',{knownList:false},'held'],['waiting',{cleaned:false},'held'],
  ['held',{started:'1 minute'},'held'],['waiting',{age:'10 minutes',cleaned:false,defer:true},'pending']
 ]){const x=await seed(state,options);if(options.defer)await q("update icash_research_private.owner_export_preflights set next_check_at=now()+interval '1 minute' where id=$1",[x.parent]);const old=await digest(x.parent);assert.equal((await x.claim()).status,expected,JSON.stringify([state,options]));assert.equal(await digest(x.parent),old);}
 const mutations=[
  x=>q('update icash_accounts set bot_paused=true where id=$1',[x.account]),
  ()=>pg.exec('update fixture_settings set quota=false'),
  ()=>pg.exec('update fixture_settings set people_available=false'),
  ()=>pg.exec('update fixture_settings set unstarted=false'),
  ()=>pg.exec('update fixture_settings set mobile=true'),
  x=>q('insert into icash_operation_spend values($1,$2)',['owners:'+x.account+':'+x.screening,'dispatched']),
  x=>q('insert into icash_property_controls values($1,$2,true)',[x.account,x.snapshot.propertyId]),
  x=>q('update icash_discovery_configs set contacts_enabled=false where account_id=$1',[x.account]),
  x=>q("update icash_screening_jobs set completed_at=now()-interval '25 hours' where id=$1",[x.screening]),
  x=>q("update icash_screening_jobs set snapshot=jsonb_set(snapshot,'{propertyId}','\"changed\"') where id=$1",[x.screening]),
  x=>q('update icash_wallets set balance_cents=0 where account_id=$1',[x.account]),
 ];
 for(const mutate of mutations){await pg.exec('begin');const x=await seed();await mutate(x);const result=await x.claim();assert(['held','quota_wait'].includes(result.status));assert.equal(await v('select count(*)::int from icash_research_private.owner_export_preflights where account_id=$1',[x.account]),1);await pg.exec('rollback');}
 for(const role of ['anon','authenticated','service_role']){
  assert.equal(await v("select has_function_privilege($1,'icash_research_private.owner_preflight_renewable(uuid)','execute')",[role]),false);
  assert.equal(await v("select has_table_privilege($1,'icash_research_private.owner_export_preflights','insert')",[role]),false);
 }
 assert.equal(await v('select count(*)::int from fixture_purchases'),1,'Only the explicit offline mock admission recorded a purchase');
 console.log('PASS immutable free-preflight renewal: staged switch, expired positive/empty/abandoned checks, confirmed cleanup, new delayed counts, no old evidence reuse, Pause/source/pool/funds/unknown-purchase guards and private ACLs.');
}finally{await pg.close();}
