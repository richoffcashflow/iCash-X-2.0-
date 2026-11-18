// Exercise the original-file path with the same owner, CSV and settlement fixtures as normal exports.
import assert from 'node:assert/strict';
import {activeOwnerColumns,allocateActiveOwnerExport,parseOwnerExportCsv} from '../../lib/owner-active-export.ts';
import {ownerBatchAudience} from '../../lib/owner-batch.ts';

export async function testOriginalOwnerDownload({db,q,v,rpc,read,admit,batch,account,other,request,items,preview}){
 await db.exec('begin');
 try{
  await db.exec(`alter table icash_research_private.requests add column finished_at timestamptz,add column result jsonb;
   alter table icash_research_private.owner_exports add column if not exists capacity_review_id uuid;
   create table if not exists public.icash_dealmachine_request_budget(id int primary key);
   create table icash_research_private.owner_export_quota_policy(id int primary key,enabled boolean);
   insert into icash_research_private.owner_export_quota_policy values(1,false);
   create table icash_research_private.owner_export_quota_requests(batch_id uuid,ordinal int);
   create function icash_research_private.owner_export_quota_history_ready(uuid) returns boolean language sql as $$select false$$;`);
  const quota=read('config/owner-export-quota-continuation.sql');
  const start=quota.indexOf('do $$declare d text;old_part text;new_part text;begin');
  assert(start>=0);await db.exec(quota.slice(start,quota.indexOf('end$$;',start)+7));
  await db.exec(read('config/original-owner-export-download.sql'));
  const raw={status:'completed',export_id:'fixture-file',record_count:1,file_count:1,credits:{used:1,people:1},
   download_urls:[{filename:'one.csv.gz',url:'https://storage.googleapis.com/fixture/one.csv.gz?GoogleAccessId=fixture&Expires=4102444800&Signature=fixture'}]};
  const receipt=body=>({httpStatus:200,raw:body,rawText:JSON.stringify(body)});
  const claim=(a=account)=>rpc('icash_claim_original_owner_download',[a,batch]);
  const publish=async(body=raw)=>{
   assert.equal(await admit(),'claimed');
   assert.equal(await rpc('icash_record_owner_export_receipt',[account,batch,receipt(body)]),true);
   await q("update icash_research_private.requests set finished_at=clock_timestamp(),result=$2 where id=$1",[batch,{outcome:'response',httpStatus:200,creditsUsed:1}]);
  };
  for(const mutate of [r=>{r.status='processing';},r=>{r.download_urls=[];},r=>{r.download_urls[0].url='https://other.test/file';},r=>{r.credits.used=0;},r=>{r.record_count=0;}]){
   await db.exec('savepoint ineligible');const body=structuredClone(raw);mutate(body);await publish(body);
   assert.equal(await claim(),null);await db.exec('rollback to ineligible');
  }
  await publish();assert.equal(await claim(other),null);
  await db.exec('savepoint orphan');await q("update icash_research_private.requests set finished_at=null where id=$1",[batch]);assert.equal(await claim(),null);await db.exec('rollback to orphan');
  const saved=await claim();assert.equal(saved.originalDownload,true);assert.equal(saved.receipt.raw.export_id,raw.export_id);
  assert.equal(await rpc('icash_record_owner_export_recovery',[batch,saved.lease,receipt({data:raw})]),false,'Direct lease cannot record a status GET');
  assert.equal(await claim(),null);assert.equal(await rpc('icash_claim_owner_export_recovery',[batch]),null,'ordinary recovery waits for the direct lease');
  const fields=Object.fromEntries(activeOwnerColumns.map(k=>[k,'']));
  Object.assign(fields,{internal_person_id:request.people_ids[0].slice(4),person_full_name:'Fixture',phone_1:'2145550100',is_phone_1_dnc:'No',people_phone_1_type_id:'Wireless',has_active_phone_number:'Yes'});
  const csv=[activeOwnerColumns.join(','),activeOwnerColumns.map(k=>fields[k]).join(',')].join('\n')+'\n';
  assert.equal(await rpc('icash_record_owner_export_artifact',[batch,other,csv]),false);
  assert.equal(await rpc('icash_record_owner_export_artifact',[batch,saved.lease,csv]),true);
  const results=allocateActiveOwnerExport(saved,csv,ownerBatchAudience(preview,items,25)),rows=parseOwnerExportCsv(csv);
  await db.exec('savepoint direct_settle');assert.equal(await rpc('icash_save_owner_active_export',[batch,saved.lease,results,rows]),true);
  assert.equal(Number(await v('select sum(settled_used) from public.icash_operation_spend')),1);
  assert.equal(await v('select recovery from icash_research_private.owner_exports where id=$1',[batch]),null,'No metadata GET receipt is manufactured');
  assert.equal(Number(await v('select count(*) from icash_research_private.requests')),1,'Only the paid purchase used DealMachine quota');
  await db.exec('rollback to direct_settle');
  await q("update icash_research_private.owner_exports set recovery_attempts=6,lease_until=now()-interval '1 second',next_recover_at=now()-interval '1 second' where id=$1",[batch]);
  await db.exec('update icash_research_private.owner_export_settings set cached_artifact_recovery_enabled=true');
  const local=await rpc('icash_claim_owner_export_recovery',[batch]);assert(local?.localOnly&&local.originalArtifact);assert.equal(local.csv,csv);
  assert.equal(await rpc('icash_save_owner_active_export',[batch,local.lease,results,rows]),true);
  for(const role of ['anon','authenticated'])assert.equal(await v("select has_function_privilege($1,'public.icash_claim_original_owner_download(uuid,uuid)','execute')",[role]),false);
 }finally{await db.exec('rollback');}
}
