import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {activeOwnerExportRequest} from '../lib/owner-active-export.ts';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8'),pg=new PGlite();
const q=(s,a=[])=>pg.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,account=id(1),other=id(2);
const items=[3,4].map(n=>({screeningId:id(n),snapshot:{propertyId:'prop_'+n},ids:['per_'+n]})),request=activeOwnerExportRequest(['per_3','per_4']);
const receipt=raw=>({httpStatus:200,raw,rawText:JSON.stringify(raw)});
const claim=(a=account,its=items,r=request)=>v('select icash_claim_owner_preflight($1,$2,$3)',[a,its,r]);
const record=(c,step,raw)=>v('select icash_record_owner_preflight($1,$2,$3,$4)',[c.id,c.lease,step,raw]);
const created=c=>receipt({data:{list_id:'list-'+c.id,name:c.name,source_type:'people',status:'completed',total_count:2}});
const count=n=>receipt({total_people:n,total_results:n,total_properties:2});
const admit=(its=items,r=request)=>v('select icash_admit_owner_active_export($1,$2,$3,$4,$5,$6,$7)',[account,items[0].screeningId,id(90),its,{}, {},r]);
try{
 await pg.exec(read('tests/fixtures/owner-preflight-foundation.sql'));
 const sql=read('config/owner-export-preflight.sql');assert.equal(sql,read('supabase/migrations/20261102071159_owner_export_preflight.sql'));await pg.exec(sql);
 await q('insert into icash_accounts(id) values($1),($2)',[account,other]);
 for(const i of items)await q("insert into icash_screening_jobs values($1,$2,'complete',$3)",[i.screeningId,account,i.snapshot]);
 assert.equal((await claim()).status,'disabled');assert.equal(await admit(),'claimed');await pg.exec('truncate fixture_purchases;update icash_research_private.owner_export_settings set preflight_enabled=true');
 assert.equal(await admit(),'held','No purchase before exact positive counts');assert.equal((await claim(other)).status,'held','Foreign account cannot create a list from these snapshots');
 await pg.exec('update fixture_settings set quota=false');assert.equal((await claim()).status,'quota_wait');await pg.exec('update fixture_settings set quota=true');
 const c=await claim();assert.equal(c.status,'create');assert.equal((await claim()).status,'pending','One durable creation only');assert.equal(await record({...c,lease:id(99)},'create',created(c)),'held');
 assert.equal(await record(c,'create',created(c)),'pending');assert.equal(await record(c,'create',created(c)),'pending','Same original receipt is idempotent');
 assert.equal((await claim()).status,'pending','Completed list is not immediately searchable');
 assert.equal(await v('select icash_defer_owner_preflight($1,$2,$3,$4,$5)',[id(10),account,items[0].screeningId,'token','owners:'+account+':'+items[0].screeningId]),true);
 assert.equal(await v('select icash_defer_owner_preflight($1,$2,$3,$4,$5)',[id(10),other,items[0].screeningId,'token','owners:'+other+':'+items[0].screeningId]),false);
 await q("update icash_research_private.owner_export_preflights set next_check_at=now()-interval '1 second' where id=$1",[c.id]);
 const checking=await claim();assert.equal(checking.status,'check');assert.notEqual(checking.lease,c.lease);assert.equal((await claim()).status,'pending');
 assert.equal(await record(checking,'eligible',count(0)),'held','Cannot skip scope count');assert.equal(await record(checking,'baseline',count(2)),'checking');
 await pg.exec('begin;savepoint positive');
 assert.equal(await record(checking,'eligible',count(1)),'ready');assert.equal((await claim()).status,'ready');assert.equal(await admit(),'claimed');
 assert.equal(await admit(items,{...request,mobile_only:true}),'held','Positive evidence cannot widen or change the export');
 await assert.rejects(q("update icash_research_private.owner_export_preflights set receipts=jsonb_set(receipts,'{eligible,raw,total_people}','2') where id=$1",[c.id]),/immutable/);
 await pg.exec('rollback to positive');
 assert.equal(await record(checking,'eligible',count(0)),'empty');assert.equal(await admit(),'held');assert.equal((await claim()).status,'empty');
 assert.equal(await v('select icash_pending_opportunity_count($1)',[account]),0,'All empty siblings leave the discovery buffer');
 assert.equal(await v('select icash_enrichment_before_prospecting_budget($1)',[account]),null);
 await q("insert into icash_screening_jobs values($1,$2,'complete',$3)",[id(5),account,{propertyId:'prop_5'}]);
 assert.equal(await v('select icash_enrichment_before_prospecting_budget($1)',[account]),id(5),'Known-empty first rows do not starve later work');
 assert.deepEqual(await v('select icash_owner_batch_candidates($1,$2)',[account,id(5)]),[id(5)]);
 assert.equal(await v('select icash_owner_preflight_empty($1,$2,$3)',[account,items[0].screeningId,{propertyId:'prop_changed'}]),false,'Changed source is not filtered');
 await pg.exec('update fixture_settings set mobile=true');assert.equal(await v('select icash_pending_opportunity_count($1)',[account]),3,'Different phone pool retains its own evidence');await pg.exec('update fixture_settings set mobile=false');
 const cleanup=await v('select icash_claim_owner_preflight_cleanup($1)',[c.id]);assert.equal(cleanup.listId,'list-'+c.id);assert.equal(await v('select icash_claim_owner_preflight_cleanup($1)',[c.id]),null);
 assert.equal(await v('select icash_record_owner_preflight_cleanup($1,$2,$3)',[c.id,cleanup.token,receipt({data:{deleted:true}})]),true);assert.equal(await v('select icash_claim_owner_preflight_cleanup($1)',[c.id]),null);
 assert.equal(await v('select count(*)::int from fixture_purchases'),0);
 for(const role of ['anon','authenticated','service_role']){
  assert.equal(await v("select has_function_privilege($1,'icash_claim_owner_preflight(uuid,jsonb,jsonb)','execute')",[role]),role==='service_role');
  assert.equal(await v("select has_table_privilege($1,'icash_research_private.owner_export_preflights','select')",[role]),false);
 }
 await pg.exec('commit');
 await assert.rejects(q('delete from icash_research_private.owner_export_preflights where id=$1',[c.id]),/immutable/);
 // Separate fresh batches: malformed/zero baseline and HTTP failures hold,
 // never become no-owner evidence or permit a purchase.
 let caseId=20;
 for(const raw of [count(0),count(1),receipt({total_people:2,total_results:99,total_properties:2}),{httpStatus:500,raw:{error:{code:'internal_error'}},rawText:'{}'}]){
  const s=id(caseId++);const its=[{screeningId:s,snapshot:{propertyId:'prop_new'},ids:['per_3','per_4']}];
  await q("insert into icash_screening_jobs values($1,$2,'complete',$3)",[s,account,its[0].snapshot]);const c=await claim(account,its);await record(c,'create',created(c));await q('update icash_research_private.owner_export_preflights set next_check_at=now() where id=$1',[c.id]);const checked=await claim(account,its);assert.equal(await record(checked,'baseline',raw),'held');assert.equal(await v('select icash_owner_preflight_empty($1,$2,$3)',[account,s,its[0].snapshot]),false);
 }
 await pg.exec("update icash_research_private.owner_export_preflights set started_at=now()-interval '6 minutes' where state='held'");
 assert.equal(await v('select count(*)::int from icash_owner_export_findings()'),4,'Stalled free checks remain visible without exposing contacts or buying data');
 console.log('PASS owner export preflight SQL: staged indexing, account/source binding, exact positive gate, zero-count sibling selection, immutable receipts, cleanup claims and private ACLs.');
}finally{await pg.close();}
