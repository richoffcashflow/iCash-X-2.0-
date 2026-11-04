import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite(),read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const q=(s,a=[])=>db.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const rpc=(name,...args)=>v('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+')',args);
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,batch=id(1),account=id(2),release='a'.repeat(40);
const failure={httpStatus:500,raw:{error:{code:'internal_error',request_id:'req_fixture'}},rawText:JSON.stringify({error:{code:'internal_error',request_id:'req_fixture'}})};
const receipt=(probe,total=130)=>{const data=probe==='inventory'?Array.from({length:Math.min(total,100)},(_,i)=>({export_id:'fixture-'+i,status:'failed',created_at:new Date().toISOString()})):[];const raw={data,pagination:{limit:100,offset:0,total:probe==='inventory'?total:0,has_more:probe==='inventory'&&total>100}};return {httpStatus:200,raw,rawText:JSON.stringify(raw),headers:{minuteRemaining:49,dayRemaining:300}};};
try{
 for(const file of ['tests/fixtures/automatic-export-foundation.sql','config/owner-export-capacity-recovery.sql','supabase/migrations/20261030012215_owner_export_capacity_precision.sql','config/automatic-export-capacity.sql','config/gateway-export-capacity.sql','config/empty-export-capacity.sql'])await db.exec(read(file));
 await q("insert into icash_research_private.owner_batches(id,account_id,created_at) values($1,$2,now()-interval '5 minutes')",[batch,account]);
 await q('insert into icash_research_private.owner_exports(id,request,receipt) values($1,$2,$3)',[batch,{people_ids:['held-owner']},failure]);
 await q("insert into icash_research_private.requests(id,kind,account_id,admitted,finished_at,result) values($1,'owner_lookup',$2,true,now()-interval '2 minutes',$3)",[batch,account,{outcome:'http_error',httpStatus:500}]);
 await q("insert into public.icash_operation_spend values('original','dispatched',100)");
 assert.equal(await rpc('icash_claim_automatic_export_capacity',release),null,'Inactive migration does not start checks');
 await db.exec('update icash_research_private.export_capacity_automation set enabled=true');
 for(const bad of [null,'','not-a-release','b'.repeat(41)])assert.equal(await rpc('icash_claim_automatic_export_capacity',bad),null);
 for(const mutate of ["update fixture_settings set quota=false","update fixture_settings set enabled=false","update icash_research_private.requests set finished_at=now()","update icash_research_private.requests set result='{}'","update icash_research_private.owner_exports set receipt=null"]){
  await db.exec('begin;'+mutate);assert.equal(await rpc('icash_claim_automatic_export_capacity',release),null);await db.exec('rollback;');
 }
 const original=await v('select to_jsonb(e) from icash_research_private.owner_exports e');
 async function probes(c,mutate=()=>{}){
  for(const probe of ['inventory','pending','processing']){
   if(probe!=='inventory'){assert(await rpc('icash_claim_export_capacity_probe',c.reviewId,probe));assert.equal(await rpc('icash_claim_export_capacity_probe',c.reviewId,probe),null,'One claim per free request');}
   const r=receipt(probe);mutate(r,probe);r.rawText=JSON.stringify(r.raw);
   assert.equal(await rpc('icash_record_export_capacity_probe',c.reviewId,probe,r),true);
   assert.equal(await rpc('icash_record_export_capacity_probe',c.reviewId,probe,r),true,'Acknowledgment recovery is identical');
   assert.equal(await rpc('icash_record_export_capacity_probe',c.reviewId,probe,{...r,rawText:'changed'}),false);
  }
 }
 for(const mutate of [
  (r,p)=>{if(p==='pending')r.raw.pagination.total=1;},
  (r,p)=>{if(p==='processing')r.raw.data=[{export_id:'running',status:'processing'}];},
  (r,p)=>{if(p==='inventory')r.raw.data[0].status='pending';},
  (r,p)=>{if(p==='inventory')r.raw.data[0].status='unknown';},
  (r,p)=>{if(p==='inventory')r.raw.data[1].export_id=r.raw.data[0].export_id;},
  (r,p)=>{if(p==='inventory')r.raw.data.forEach(x=>x.created_at='2000-01-01');},
  (r,p)=>{if(p==='inventory')r.raw.data[0].created_at='invalid';},
  (r,p)=>{if(p==='processing')r.raw.pagination.has_more=true;},
  (r,p)=>{if(p==='inventory')r.raw.pagination.has_more=false;},
  (r,p)=>{if(p==='processing')r.headers.dayRemaining=0;},
  (r,p)=>{if(p==='processing')delete r.headers.minuteRemaining;},
  (r,p)=>{if(p==='processing')r.httpStatus=500;},
 ]){
  await db.exec('begin;');const c=await rpc('icash_claim_automatic_export_capacity',release);assert(c?.requestId);
  assert.equal(await rpc('icash_claim_automatic_export_capacity',release),null);
  await probes(c,mutate);assert.equal(await rpc('icash_finish_automatic_export_capacity',c.reviewId),'capacity_review_held');
  assert.deepEqual(await v('select to_jsonb(e) from icash_research_private.owner_exports e'),original);
  assert.equal(await rpc('icash_owner_export_people_available',['held-owner']),false);
  assert.equal(await rpc('icash_claim_automatic_export_capacity',release),null,'Failed checks back off');
  await db.exec('rollback;');
 }
 for(const mutate of [
  "update icash_research_private.export_capacity_automation set enabled=false",
  "update icash_research_private.requests set result='{}' where kind='owner_lookup'",
  "update icash_research_private.owner_exports set receipt=null",
  "alter table icash_research_private.owner_export_capacity_reviews disable trigger owner_export_capacity_review_immutable; update icash_research_private.owner_export_capacity_reviews set started_at=now()-interval '1 minute'; alter table icash_research_private.owner_export_capacity_reviews enable trigger owner_export_capacity_review_immutable",
 ]){
  await db.exec('begin;');const c=await rpc('icash_claim_automatic_export_capacity',release);await probes(c);await db.exec(mutate);
  assert.equal(await rpc('icash_finish_automatic_export_capacity',c.reviewId),'capacity_review_held');assert.equal(await v('select capacity_review_id from icash_research_private.owner_exports'),null);await db.exec('rollback;');
 }
 // A stopped worker must not create permanent manual intervention. Its next
 // attempt gets a different review and request, preserving the interrupted one.
 await db.exec('begin;');const interrupted=await rpc('icash_claim_automatic_export_capacity',release);
 await db.exec("alter table icash_research_private.owner_export_capacity_reviews disable trigger owner_export_capacity_review_immutable; update icash_research_private.owner_export_capacity_reviews set created_at=now()-interval '3 minutes',started_at=now()-interval '3 minutes'; alter table icash_research_private.owner_export_capacity_reviews enable trigger owner_export_capacity_review_immutable;");
 const old=await v('select to_jsonb(r) from icash_research_private.owner_export_capacity_reviews r');
 const retry=await rpc('icash_claim_automatic_export_capacity','b'.repeat(40));assert.notEqual(retry.reviewId,interrupted.reviewId);assert.notEqual(retry.requestId,interrupted.requestId);
 assert.deepEqual(await v('select to_jsonb(r) from icash_research_private.owner_export_capacity_reviews r where id=$1',[interrupted.reviewId]),old);
 assert.equal(await rpc('icash_claim_automatic_export_capacity',release),null);
 await db.exec('rollback;');
 // A manual review is never converted into automatic authority.
 await db.exec('begin;');await q('insert into icash_research_private.owner_export_capacity_reviews(export_id,receipt_hash,reviewed_release) values($1,md5($2::jsonb::text),$3)',[batch,failure,release]);assert.equal(await rpc('icash_claim_automatic_export_capacity',release),null);await db.exec('rollback;');
 // A lost final-save response is recoverable without another provider request.
 const good=await rpc('icash_claim_automatic_export_capacity',release);await probes(good);
 assert.equal(await rpc('icash_finish_automatic_export_capacity',good.reviewId),'capacity_verified');
 assert.equal(await rpc('icash_finish_automatic_export_capacity',good.reviewId),'capacity_verified');
 assert.equal(await rpc('icash_owner_active_export_capacity'),'ready');
 assert.equal(await rpc('icash_owner_export_people_available',['held-owner']),false);
 assert.equal(await v("select state from icash_operation_spend where operation_key='original'"),'dispatched');
 const after=await v('select to_jsonb(e) from icash_research_private.owner_exports e');assert.deepEqual({...after,capacity_review_id:null},original);
 assert.equal(await v('select count(*)::integer from icash_research_private.export_capacity_probes'),3);
 for(const sql of ["update icash_research_private.owner_export_capacity_reviews set auto_policy=null,auto_attempt=0","delete from icash_research_private.export_capacity_probes","update icash_research_private.export_capacity_probes set receipt='{}'"]){await assert.rejects(db.exec(sql));}
 for(const role of ['anon','authenticated'])for(const sig of ['icash_claim_automatic_export_capacity(text)','icash_claim_export_capacity_probe(uuid,text)','icash_record_export_capacity_probe(uuid,text,jsonb)','icash_finish_automatic_export_capacity(uuid)'])assert.equal(await v('select has_function_privilege($1,$2,\'execute\')',[role,sig]),false);
 assert.equal(await v("select has_table_privilege('service_role','icash_research_private.export_capacity_probes','select')"),false);
 // A real completed gateway response is distinct from an interrupted request.
 // Only scheduling capacity may recover; the unknown purchase remains fenced.
 const gateway=id(11),gatewayOwner='gateway-held-owner';
 const gatewayReceipt={httpStatus:504,raw:null,rawText:'<html><title>dealmachine.com | 504: Gateway time-out</title><body>api.v2.dealmachine.com</body></html>'};
 await q("insert into icash_research_private.owner_batches(id,account_id,created_at) values($1,$2,now()-interval '8 minutes')",[gateway,account]);
 await q('insert into icash_research_private.owner_exports(id,request,receipt) values($1,$2,$3)',[gateway,{people_ids:[gatewayOwner]},gatewayReceipt]);
 await q("insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,created_at,finished_at,result) values($1,'owner_lookup',$2,$3,true,now()-interval '8 minutes',now()-interval '6 minutes',$4)",[gateway,account,'owner-batch:'+gateway,{outcome:'http_error',httpStatus:504}]);
 await q("insert into icash_operation_spend values('gateway-original','dispatched',105)");
 assert.equal(await rpc('icash_claim_automatic_export_capacity',release),null,'Gateway recovery is staged disabled');
 await db.exec('update icash_research_private.export_capacity_automation set gateway_enabled=true');
 const gatewayBefore=await v('select to_jsonb(e) from icash_research_private.owner_exports e where id=$1',[gateway]);
 const requestBefore=await v('select to_jsonb(q) from icash_research_private.requests q where id=$1',[gateway]);
 for(const mutate of [
  "update icash_research_private.requests set finished_at=null where result->>'httpStatus'='504'",
  "update icash_research_private.requests set finished_at=now() where result->>'httpStatus'='504'",
  "update icash_research_private.requests set result='{}' where result->>'httpStatus'='504'",
  "update icash_research_private.requests set operation_key='wrong' where result->>'httpStatus'='504'",
  "update icash_research_private.requests set account_id=null where result->>'httpStatus'='504'",
  "update icash_research_private.owner_exports set recovery='{}' where receipt->>'httpStatus'='504'",
  "update icash_research_private.owner_exports set lease_until=now()+interval '1 minute' where receipt->>'httpStatus'='504'",
  "update icash_research_private.owner_exports set receipt=jsonb_set(receipt,'{raw}', '{\"export_id\":\"known\"}') where receipt->>'httpStatus'='504'",
  "update icash_research_private.owner_exports set receipt=jsonb_set(receipt,'{rawText}', '\"unverified proxy response\"') where receipt->>'httpStatus'='504'",
  "update icash_research_private.owner_batches set paid_receipt='{}'",
 ]){
  await db.exec('begin;'+mutate);assert.equal(await rpc('icash_claim_automatic_export_capacity',release),null);await db.exec('rollback;');
 }
 await db.exec('begin;');const busyGateway=await rpc('icash_claim_automatic_export_capacity',release);await probes(busyGateway,(r,p)=>{if(p==='processing')r.raw.pagination.total=1;});
 assert.equal(await rpc('icash_finish_automatic_export_capacity',busyGateway.reviewId),'capacity_review_held');
 assert.equal(await rpc('icash_claim_automatic_export_capacity',release),null,'Gateway failures use durable backoff');await db.exec('rollback;');
 await db.exec('begin;');const disabledGateway=await rpc('icash_claim_automatic_export_capacity',release);await probes(disabledGateway);
 await db.exec('update icash_research_private.export_capacity_automation set gateway_enabled=false');
 assert.equal(await rpc('icash_finish_automatic_export_capacity',disabledGateway.reviewId),'capacity_review_held');await db.exec('rollback;');
 const gatewayClaim=await rpc('icash_claim_automatic_export_capacity',release);await probes(gatewayClaim);
 assert.equal(await rpc('icash_finish_automatic_export_capacity',gatewayClaim.reviewId),'capacity_verified');
 assert.equal(await rpc('icash_finish_automatic_export_capacity',gatewayClaim.reviewId),'capacity_verified');
 assert.equal(await v('select auto_policy from icash_research_private.owner_export_capacity_reviews where id=$1',[gatewayClaim.reviewId]),'gateway-idle-v1');
 assert.equal(await rpc('icash_owner_active_export_capacity'),'ready');
 assert.equal(await rpc('icash_owner_export_people_available',[gatewayOwner]),false);
 assert.deepEqual({...await v('select to_jsonb(e) from icash_research_private.owner_exports e where id=$1',[gateway]),capacity_review_id:null},gatewayBefore);
 assert.deepEqual(await v('select to_jsonb(q) from icash_research_private.requests q where id=$1',[gateway]),requestBefore);
 assert.equal(await v("select state from icash_operation_spend where operation_key='gateway-original'"),'dispatched');
 for(const role of ['anon','authenticated','service_role'])for(const sig of ['capacity_source_current(uuid,text)','capacity_source_policy(uuid,text)','capacity_source_before_gateway(uuid,text)'])assert.equal(await v('select has_function_privilege($1,$2,\'execute\')',[role,'icash_research_private.'+sig]),false);
 console.log('PASS automatic capacity SQL: exact completed 500/504 failures, three fresh idle probes, staged activation, durable backoff, unchanged purchases, owner fences and private ACLs.');
}finally{await db.close();}
