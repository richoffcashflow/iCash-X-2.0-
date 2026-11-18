import assert from 'node:assert/strict';

export async function testNoRecordsExportCapacity({db,q,v,rpc,probes,snapshot,release,migration}){
 const message='No records matched this export. Filters and scrub settings (like "Active phone numbers only") may have excluded every record — adjust them and try again.';
 const error={code:'no_records_matched',message,request_id:'req_fixture'};
 const policy=()=>v("select icash_research_private.capacity_source_policy(id,md5(receipt::text)) from icash_research_private.owner_exports");
 async function saveResponse(errorFields=error,extra={}){
  const raw={error:errorFields};
  await q('update icash_research_private.owner_exports set receipt=$1',[{httpStatus:400,raw,rawText:JSON.stringify(raw),...extra}]);
  await q('update icash_research_private.owner_batches set paid_receipt=$1',[raw]);
 }
 await db.exec('begin');
 try{
  await db.exec("alter table icash_research_private.owner_exports add column artifact_sha256 text,add column parsed_rows jsonb,add column recovery_history jsonb not null default '[]';");
  await saveResponse();
  await db.exec("update icash_research_private.requests set result=jsonb_build_object('outcome','http_error','httpStatus',400),finished_at=now() where kind='owner_lookup'");
  assert.equal(await policy(),null,'The old reader misses the provider’s specific no-records code');
  await db.exec(migration);
  assert.equal(await policy(),'empty-idle-v1');
  for(const fields of [{...error,code:'unknown'}, {...error,message:'No records'}, {...error,export_id:'provider-export'}, {...error,request_id:''}]){
   await saveResponse(fields);assert.equal(await policy(),null);
  }
  await saveResponse(error,{creditsUsed:1});assert.equal(await policy(),null);
  await saveResponse({...error,code:'invalid_request'});assert.equal(await policy(),'empty-idle-v1','The original error family remains supported');
  await saveResponse();
  for(const change of [
   "update icash_research_private.owner_exports set artifact_sha256='artifact'",
   "update icash_research_private.owner_exports set parsed_rows='[]'",
   "update icash_research_private.owner_exports set recovery_history='[{}]'",
   "update icash_research_private.owner_batches set results='{}'",
   "update icash_research_private.requests set finished_at=null where kind='owner_lookup'",
   "update icash_research_private.export_capacity_automation set empty_enabled=false",
  ]){
   await db.exec('savepoint change');await db.exec(change);assert.equal(await policy(),null,change);
   await db.exec('rollback to change; release savepoint change');
  }
  const before=await snapshot();
  const claim=await rpc('icash_claim_automatic_export_capacity',release);assert(claim?.requestId);
  assert.equal(await rpc('icash_owner_active_export_capacity'),'export_busy');
  await probes(claim);
  await db.exec('savepoint contradictory');
  await db.exec("update icash_research_private.owner_exports set artifact_sha256='late-artifact'");
  assert.equal(await rpc('icash_finish_automatic_export_capacity',claim.reviewId),'capacity_review_held');
  await db.exec('rollback to contradictory; release savepoint contradictory');
  assert.equal(await rpc('icash_finish_automatic_export_capacity',claim.reviewId),'capacity_verified');
  assert.equal(await rpc('icash_owner_active_export_capacity'),'ready');
  const after=await snapshot();
  assert.deepEqual({...after,export:{...after.export,capacity_review_id:null}},before);
  assert.equal(await rpc('icash_owner_export_people_available',['held-owner']),false);
  assert.equal(await v('select count(*)::int from icash_research_private.export_capacity_probes'),3);
  await db.exec('savepoint replay');await assert.rejects(db.exec(migration),/predecessor changed/);
  await db.exec('rollback to replay; release savepoint replay');
 }finally{await db.exec('rollback');}
 assert.equal(await v("select md5(pg_get_functiondef('icash_research_private.capacity_source_before_unknown(uuid,text)'::regprocedure))"),'8345639c552e5f75dcad80b9f9f7bf4e','An interrupted migration rolls back the source change');
}
