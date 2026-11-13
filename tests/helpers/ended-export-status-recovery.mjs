import assert from 'node:assert/strict';

export async function testEndedExportStatusRecovery({db,q,v,rpc,probes,snapshot,release}){
 const seed="update icash_research_private.requests set result=null,finished_at=null where kind='owner_lookup';";
 const flag='update icash_research_private.export_capacity_automation set missing_finish_enabled=true;';
 const claim=()=>rpc('icash_claim_automatic_export_capacity',release);
 assert.equal(await v('select missing_finish_enabled from icash_research_private.export_capacity_automation'),false);
 await db.exec('begin;'+seed);
 assert.equal(await claim(),null,'Missing status installs disabled even with unknown recovery enabled');
 await db.exec('rollback;');
 for(const change of [
  'update icash_research_private.export_capacity_automation set enabled=false',
  'update icash_research_private.export_capacity_automation set unknown_enabled=false',
  'update icash_research_private.export_capacity_automation set missing_finish_enabled=false',
  "update icash_research_private.requests set result='{\"outcome\":\"unknown\"}'",
  "update icash_research_private.requests set finished_at=now()-interval '8 minutes'",
  "update icash_research_private.requests set created_at=created_at-interval '1 second'",
  "update icash_research_private.requests set created_at=now()-interval '1 minute'",
  'update icash_research_private.requests set admitted=false',
  'update icash_research_private.requests set account_id=null',
  "update icash_research_private.requests set operation_key='wrong'",
  "update icash_research_private.requests set kind='owner_preview'",
  "update icash_research_private.owner_batches set paid_receipt='{}'",
  "update icash_research_private.owner_batches set state='complete'",
  "update icash_research_private.owner_exports set receipt='{}'",
  "update icash_research_private.owner_exports set recovery='{}'",
  "update icash_research_private.owner_exports set csv='late artifact'",
  "update icash_research_private.owner_exports set lease_until=now()+interval '1 minute'",
  'update public.icash_automation_tickets set completed_at=null',
  "update public.icash_automation_tickets set completed_at=created_at",
  "update public.icash_automation_tickets set completed_at=now()-interval '1 minute'",
  "update public.icash_automation_tickets set state='issued'",
  "update public.icash_automation_tickets set outcome='complete'",
  'update public.icash_automation_tickets set issue_attempts=2',
  "update public.icash_automation_tickets set expires_at=now()+interval '1 minute'",
  'update public.icash_automation_tickets set screening_id=null',
  'insert into public.icash_automation_tickets select gen_random_uuid(),account_id,screening_id,kind,state,created_at,expires_at,completed_at,outcome,issue_attempts from public.icash_automation_tickets',
 ]){
  await db.exec('begin;'+seed+flag+change);
  assert.equal(await claim(),null,change);await db.exec('rollback;');
 }
 for(const mutate of [
  (r,p)=>{if(p==='inventory')r.headers.date=null;},
  (r,p)=>{if(p==='processing')r.headers.age='1';},
  (r,p)=>{if(p==='pending')r.raw.pagination.total=1;},
  (r,p)=>{if(p==='inventory')r.raw.data[0].status='processing';},
 ]){
  await db.exec('begin;'+seed+flag);const before=await snapshot();const c=await claim();assert(c?.requestId);await probes(c,mutate);
  assert.equal(await rpc('icash_finish_automatic_export_capacity',c.reviewId),'capacity_review_held');
  assert.deepEqual(await snapshot(),before);await db.exec('rollback;');
 }
 for(const change of [
  'update icash_research_private.export_capacity_automation set missing_finish_enabled=false',
  "update icash_research_private.requests set result='{\"outcome\":\"unknown\"}',finished_at=now() where kind='owner_lookup'",
  "update public.icash_automation_tickets set outcome='changed'",
 ]){
  await db.exec('begin;'+seed+flag);const c=await claim();assert(c?.requestId);await probes(c);await db.exec(change);
  assert.equal(await rpc('icash_finish_automatic_export_capacity',c.reviewId),'capacity_review_held');
  assert.equal(await v('select capacity_review_id from icash_research_private.owner_exports'),null);await db.exec('rollback;');
 }
 await db.exec('begin;'+seed+flag);const before=await snapshot();const c=await claim();await probes(c);
 assert.equal(await v("select source_snapshot#>'{request,result}'='null'::jsonb and source_snapshot#>'{request,finished_at}'='null'::jsonb from icash_research_private.owner_export_capacity_reviews"),true);
 assert.equal(await rpc('icash_finish_automatic_export_capacity',c.reviewId),'capacity_verified');
 assert.equal(await rpc('icash_finish_automatic_export_capacity',c.reviewId),'capacity_verified');
 assert.equal(await rpc('icash_owner_active_export_capacity'),'ready');
 assert.equal(await rpc('icash_owner_export_people_available',['held-owner']),false);
 const after=await snapshot();assert.deepEqual({...after,export:{...after.export,capacity_review_id:null}},before);
 await db.exec('rollback;');
 console.log('PASS ended export missing status: exact expired handler, disabled/ambiguous/partial status refusal, fresh complete inventory, changed source, and original null evidence/money preservation.');
}
