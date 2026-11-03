import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {ownerBatchAudience,phoneLessOwnerPreviews,enrichOwnerBatch} from '../lib/owner-batch.ts';
import {enrichActiveOwners} from '../lib/owner-active-export.ts';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=new PGlite(),q=(s,a=[])=>pg.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const save=c=>v('select icash_record_empty_owner_preview($1,$2,$3,$4,$5)',[c.account,c.batch,c.request,c.items,c.preview]);
const empty=(c,i=0,snapshot=c.items[i].snapshot)=>v('select icash_owner_preflight_empty($1,$2,$3)',[c.account,c.items[i].screeningId,snapshot]);
let next=1;
const seed=()=>v('select fixture_empty_preview_seed($1)',[next++]);
const count=()=>v('select count(*)::integer from icash_research_private.owner_empty_preview_receipts');
try{
 await pg.exec(read('tests/fixtures/owner-preview-empty.sql'));
 const def=read('config/owner-enrichment-deferral.sql');
 await pg.exec(def.slice(def.indexOf('create function public.icash_owner_enrichment_unstarted'),def.indexOf('-- Additional retry gates')));
 await pg.exec(read('config/owner-enrichment-evidence-indexes.sql'));
 const c=await seed();
 for(let i=0;i<5;i++)assert.equal(await empty(c,i),false,'Reproduce every phone-less sibling staying selectable');
 const migration=read('config/owner-preview-empty.sql');
 assert.equal(migration,read('supabase/migrations/20261103041149_owner_preview_empty.sql'));await pg.exec(migration);
 assert.equal(phoneLessOwnerPreviews(ownerBatchAudience(c.preview,c.items,25)).length,5);
 await pg.exec('set role service_role');
 try{
  assert.equal(await save(c),true,'The real service role can resolve and execute the RPC in a recreated public schema');
  assert.equal(await empty(c),true,'The real service role can read the exclusion only through its granted RPC');
  await assert.rejects(q('select * from icash_research_private.owner_empty_preview_receipts'),/permission denied/);
 }finally{await pg.exec('reset role');}
 assert.equal(await count(),1);
 for(let i=0;i<5;i++)assert.equal(await empty(c,i),true,'One original preview excludes all five exact source snapshots');
 assert.equal(await v('select count(*)::integer from icash_research_private.owner_empty_preview_items'),5);
 const original=await v('select jsonb_build_object(\'receipt\',to_jsonb(r),\'items\',(select jsonb_agg(to_jsonb(i) order by screening_id) from icash_research_private.owner_empty_preview_items i)) from icash_research_private.owner_empty_preview_receipts r');
 assert.equal(await save(c),true);assert.equal(await count(),1);
 assert.deepEqual(await v('select jsonb_build_object(\'receipt\',to_jsonb(r),\'items\',(select jsonb_agg(to_jsonb(i) order by screening_id) from icash_research_private.owner_empty_preview_items i)) from icash_research_private.owner_empty_preview_receipts r'),original,'Idempotent acknowledgment never renews evidence');
 assert.equal(await empty(c,0,{...c.items[0].snapshot,propertyId:'prop_changed'}),false);
 assert.equal(await v('select icash_owner_preflight_empty(gen_random_uuid(),$1,$2)',[c.items[0].screeningId,c.items[0].snapshot]),false);
 const mixed=await seed();mixed.preview.data[1].contacts[0].availability.phones=2;delete mixed.preview.data[2].contacts[0].availability;delete mixed.preview.data[3].contacts[0].availability.phones;mixed.preview.data[4].contacts[0].contact_type='renter';
 const parsed=ownerBatchAudience(mixed.preview,mixed.items,25);assert.deepEqual(phoneLessOwnerPreviews(parsed).map(x=>x.screeningId),[mixed.items[0].screeningId]);
 assert.equal(await save(mixed),true);for(let i=0;i<5;i++)assert.equal(await empty(mixed,i),i===0,'Positive/unknown phones and weak owner matches remain unclassified');
 for(const mutate of [p=>{delete p.preview.credits.used;},p=>{p.preview.credits.used=1;},p=>{p.preview.data[0].contacts[0].availability.phones='0';},p=>{p.preview.data[0].contacts[0].availability.phones=-1;},p=>{p.preview.data[0].contacts[0].is_likely_owner='true';},p=>{p.preview.data[0].contacts.push({...p.preview.data[0].contacts[0],availability:{phones:2}});},p=>{p.preview.data[0].dm_property_id='prop_missing';},p=>{p.items[0].snapshot.propertyId='prop_missing';},p=>{p.preview.totals.submitted=4;},p=>{p.preview.data[0].error=null;},p=>{p.batch='00000000-0000-0000-0000-000000000000';},p=>{p.items[0].screeningId=p.items[1].screeningId;}]){
  const bad=await seed();mutate(bad);const before=await count();assert.equal(await save(bad),false);assert.equal(await count(),before);
 }
 for(const mutation of ["update icash_accounts set bot_paused=true where id=$1","update icash_accounts set work_allowed=false where id=$1","update icash_screening_jobs set snapshot=snapshot||'{\"changed\":true}' where account_id=$1","update icash_screening_jobs set completed_at=now()-interval '25 hours' where account_id=$1","update icash_research_private.requests set created_at=now()-interval '3 minutes' where account_id=$1","update icash_research_private.requests set result='{\"outcome\":\"unknown\"}' where account_id=$1"]){
  const bad=await seed();await q(mutation,[bad.account]);assert.equal(await save(bad),false);
 }
 for(const result of [{outcome:'response',httpStatus:200,creditsUsed:0},{outcome:'response',httpStatus:200,creditsUsed:0,returned:'5'},{outcome:'response',httpStatus:200,creditsUsed:0,returned:4}]){
  const bad=await seed();await q('update icash_research_private.requests set result=$1 where id=$2',[result,bad.request]);assert.equal(await save(bad),false,'Original request returned count must bind the entire preview');
 }
 for(const kind of ['operation','receipt','manual']){
  const bad=await seed(),op=`owners:${bad.account}:${bad.items[0].screeningId}`;
  if(kind==='operation')await q('insert into icash_operation_spend(operation_key,account_id) values($1,$2)',[op,bad.account]);
  if(kind==='receipt')await q("insert into icash_cost_observations values('other',$1,'original-receipt',null,'unknown')",[op+':original']);
  if(kind==='manual')await q('insert into icash_property_controls values($1,$2,true)',[bad.account,bad.items[0].snapshot.propertyId]);
  assert.equal(await save(bad),false,'Existing '+kind+' stays fenced');assert.equal(await empty(bad),false);
 }
 const old=await seed();await q('insert into fixture_preflight_empty values($1,$2,$3)',[old.account,old.items[0].screeningId,old.items[0].snapshot]);assert.equal(await empty(old),true,'Original active/DNC preflight exclusions still apply');
 await assert.rejects(q('update icash_research_private.owner_empty_preview_receipts set observed_at=now()'),/immutable/);
 await assert.rejects(q('delete from icash_research_private.owner_empty_preview_items'),/immutable/);
 await pg.exec('alter table icash_research_private.owner_empty_preview_items disable trigger owner_empty_preview_item_immutable');
 await q('update icash_research_private.owner_empty_preview_items set expires_at=now()-interval \'1 second\' where request_id=$1',[c.request]);
 await pg.exec('alter table icash_research_private.owner_empty_preview_items enable trigger owner_empty_preview_item_immutable');
 assert.equal(await empty(c),false,'Expiry permits ordinary future candidate evaluation without rewriting original evidence');
 for(const role of ['anon','authenticated','service_role']){
  assert.equal(await v('select has_function_privilege($1,\'icash_record_empty_owner_preview(uuid,uuid,uuid,jsonb,jsonb)\',\'execute\')',[role]),role==='service_role');
  assert.equal(await v('select has_function_privilege($1,\'icash_owner_preflight_empty_before_preview(uuid,uuid,jsonb)\',\'execute\')',[role]),false);
  assert.equal(await v('select has_table_privilege($1,\'icash_research_private.owner_empty_preview_receipts\',\'select\')',[role]),false);
 }
 assert.equal(await v('select count(*)::integer from icash_credit_reservations'),0);
 assert.equal(await v('select count(*)::integer from icash_owner_contacts'),0);
 // Exercise both real service paths against the real recorder and exclusion
 // predicate. Previously all five siblings were rediscovered independently.
 for(const active of [false,true]){
  const flow=await seed();let previews=0;
  for(const item of flow.items){
   const id=item.snapshot.propertyId;item.snapshot={...item.snapshot,sellerCostReserveCents:100000,raw:{data:{dm_property_id:id,full_address:'Synthetic fixture',estimated_value:200000,estimated_repair_cost:40000,total_estimated_loan_balance:50000}}};
   await q('update icash_screening_jobs set snapshot=$1 where id=$2',[item.snapshot,item.screeningId]);
  }
  const db=async(path,method,p)=>{
   if(path==='rpc/icash_owner_active_export_capacity')return 'ready';
   if(path==='rpc/icash_owner_targeting_pools')return Object.fromEntries(p.p_screenings.map(id=>[id,'active']));
   if(path==='rpc/icash_owner_batch_candidates'){
    const remaining=[];for(const item of flow.items)if(!await v('select icash_owner_preflight_empty($1,$2,$3)',[flow.account,item.screeningId,item.snapshot]))remaining.push(item);
    return remaining.some(i=>i.screeningId===p.p_screening)?remaining:[];
   }
   if(path==='rpc/icash_take_dealmachine_request'){assert.equal(p.p_kind,'owner_preview');await q('insert into icash_research_private.requests values($1,$2,$3,$4,true,clock_timestamp(),null,null)',[p.p_request,p.p_kind,p.p_account,p.p_operation]);return true;}
   if(path==='rpc/icash_finish_dealmachine_request'){await q('update icash_research_private.requests set finished_at=clock_timestamp(),result=$1 where id=$2',[p.p_result,p.p_request]);return true;}
   if(path==='rpc/icash_record_empty_owner_preview')return save({account:p.p_account,batch:p.p_batch,request:p.p_request,items:p.p_items,preview:p.p_preview});
   throw Error('Unexpected paid or other action: '+path);
  };
  const transport=async(url,init)=>{assert(String(url).endsWith('/properties/ids'));assert.equal(JSON.parse(init.body).enrich,false);previews++;return Response.json(flow.preview);};
  const config={contact_rate_id:'fixture-rate',contact_credit_cap:25,property_credit_micros:10000,data_rights_until:'2099-01-01',research_version:2};
  const run=()=>active?enrichActiveOwners(db,flow.account,flow.items[0],config,250000,transport):enrichOwnerBatch(db,flow.account,flow.items[0].screeningId,config,250000,transport);
  assert.deepEqual(await run(),{status:'empty',contacts:0});assert.equal(previews,1);
  for(let i=0;i<5;i++)assert.equal(await empty(flow,i),true);
  assert.deepEqual(await run(),{status:'held'});assert.equal(previews,1,'No second free preview for any proved-empty sibling');
 }
 console.log('Empty owner previews: original zero-credit proof excludes every explicit zero-phone sibling once; unknown/malformed/source/account/expiry/paid/Pause guards and immutable private evidence pass. No providers.');
}finally{await pg.close();}
