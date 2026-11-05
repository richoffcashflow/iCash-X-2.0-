import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite(),read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const q=(s,a=[])=>db.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const rpc=(name,...args)=>v('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+')',args);
const batch='00000000-0000-4000-8000-000000000001',account='00000000-0000-4000-8000-000000000002',screening='00000000-0000-4000-8000-000000000003',ticket='00000000-0000-4000-8000-000000000004',next='00000000-0000-4000-8000-000000000005';
const originalMoney=()=>v("select to_jsonb(s) from public.icash_operation_spend s where operation_key='original'");
const receipt=(status,raw,rawText=JSON.stringify(raw))=>({httpStatus:status,raw,rawText});
const error=receipt(500,{error:{code:'internal_error',request_id:'req_late'}});
async function newAdmission(){
 const ids=['per_2'],request={people_ids:ids,fields:['person_full_name','has_active_phone_number'],property_match:'owner',anchor:'person',limit:1,require_phone:true,scrub_dnc:true,active_phones_only:true};
 const items=[{screeningId:screening,ids,snapshot:{propertyId:'prop_new'}}];
 const preview={data:[{dm_property_id:'prop_new',found:true,contacts:[{dm_person_id:'per_2',contact_type:'owner',is_likely_owner:true,availability:{phones:1}}]}]};
 return rpc('icash_admit_owner_active_export',account,screening,next,items,preview,{},request);
}
try{
 for(const file of ['tests/fixtures/automatic-export-foundation.sql','config/owner-export-capacity-recovery.sql','supabase/migrations/20261030012215_owner_export_capacity_precision.sql','config/automatic-export-capacity.sql','config/gateway-export-capacity.sql','config/empty-export-capacity.sql','config/empty-export-immediate-capacity.sql','tests/fixtures/unknown-export-foundation.sql','tests/fixtures/unknown-export-late-foundation.sql','tests/fixtures/unknown-export-late-live-functions.sql','tests/fixtures/unknown-export-late-batch-function.sql','config/unknown-export-capacity.sql','config/unknown-export-late-evidence.sql'])await db.exec(read(file));
 await q("insert into icash_research_private.owner_batches(id,account_id,created_at,primary_screening) values($1,$2,now()-interval '10 minutes',$3)",[batch,account,screening]);
 await q('insert into icash_research_private.owner_exports(id,request) values($1,$2)',[batch,{people_ids:['per_held']}]);
 await q("insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,created_at,finished_at,result) values($1,'owner_lookup',$2,$3,true,now()-interval '10 minutes',now()-interval '8 minutes',$4)",[batch,account,'owner-batch:'+batch,{outcome:'unknown'}]);
 await q("insert into public.icash_automation_tickets values($1,$2,$3,'contacts','held',now()-interval '11 minutes',now()-interval '9 minutes',now()-interval '8 minutes','held_for_reconciliation',1)",[ticket,account,screening]);
 await db.exec("insert into public.icash_operation_spend values('original','dispatched',105);update icash_research_private.export_capacity_automation set enabled=true,unknown_enabled=true");
 const money=await originalMoney(),c=await rpc('icash_claim_automatic_export_capacity','a'.repeat(40));assert(c?.reviewId);
 for(const probe of ['inventory','pending','processing']){
  if(probe!=='inventory')assert(await rpc('icash_claim_export_capacity_probe',c.reviewId,probe));
  const data=probe==='inventory'?[{export_id:'prior-export',status:'completed',created_at:'2026-01-01T00:00:00Z'}]:[];
  const raw={data,pagination:{limit:100,offset:0,total:data.length,has_more:false}};
  const fresh=receipt(200,raw);fresh.headers={minuteRemaining:49,dayRemaining:300,date:new Date(await v('select clock_timestamp()')).toUTCString(),age:null};
  assert.equal(await rpc('icash_record_export_capacity_probe',c.reviewId,probe,fresh),true);
 }
 assert.equal(await rpc('icash_finish_automatic_export_capacity',c.reviewId),'capacity_verified');
 const review=await v('select to_jsonb(r) from icash_research_private.owner_export_capacity_reviews r where id=$1',[c.reviewId]);
 assert.equal(await rpc('icash_owner_active_export_capacity'),'ready');
 assert.equal(await rpc('icash_owner_active_export_capacity',account),'ready');
 assert.equal(await rpc('icash_owner_export_people_available',['per_held']),false);

 // A newer export already occupies the unique index. Late evidence must save
 // and re-block globally while retaining both immutable identities.
 await db.exec('begin;');
 assert.equal(await newAdmission(),'claimed');
 assert.equal(await rpc('icash_record_owner_export_receipt',account,batch,error),true);
 assert.equal(await rpc('icash_record_owner_export_receipt',account,batch,error),true,'Lost acknowledgement reuses original evidence only');
 assert.equal(await rpc('icash_record_owner_export_receipt',account,batch,receipt(503,null,'other')),false);
 assert.equal(await v('select capacity_review_id from icash_research_private.owner_exports where id=$1',[batch]),c.reviewId);
 assert.deepEqual(await v('select receipt from icash_research_private.owner_exports where id=$1',[batch]),error);
 assert.equal(await v('select count(*)::integer from icash_research_private.unknown_export_late_holds'),1);
 await q('update icash_research_private.owner_exports set terminal_at=clock_timestamp() where id=$1',[next]);
 assert.equal(await rpc('icash_owner_active_export_capacity'),'export_busy');
 assert.equal(await rpc('icash_owner_active_export_capacity',account),'export_busy');
 assert.equal(await newAdmission(),'export_busy','Final paid admission preserves late-source fence');
 assert.equal(await v('select count(*)::integer from public.icash_owner_export_findings() where resource_id=$1',[batch]),1);
 assert.deepEqual(await originalMoney(),money);
 assert.deepEqual(await v('select to_jsonb(r) from icash_research_private.owner_export_capacity_reviews r where id=$1',[c.reviewId]),review);
 await db.exec('rollback;');

 // A terminal original response can continue original-ID recovery. A batch
 // observation may be recorded first, but it no longer blocks once terminal.
 await db.exec('begin;');
 const completed=receipt(200,{export_id:'original-late-id',record_count:1,file_count:1});
 assert.equal(await rpc('icash_record_owner_export_receipt',account,batch,completed),true);
 assert.equal(await rpc('icash_owner_active_export_capacity'),'ready');
 assert.equal(await rpc('icash_owner_export_people_available',['per_held']),false,'Terminal is not financially settled');
 assert.deepEqual(await originalMoney(),money);await db.exec('rollback;');

 // A non-JSON original response bypasses the batch writer and is still saved.
 await db.exec('begin;');
 const gateway=receipt(504,null,'original gateway response');
 assert.equal(await rpc('icash_record_owner_export_receipt',account,batch,gateway),true);
 assert.equal(await rpc('icash_owner_active_export_capacity'),'export_busy');
 assert.equal(await v("select evidence->>'kind' from icash_research_private.unknown_export_late_holds"),'export_receipt');
 assert.deepEqual(await originalMoney(),money);await db.exec('rollback;');

 // The public batch writer is a separate late-evidence path. It cannot bypass
 // the capacity fence even when no export HTTP receipt has arrived yet.
 await db.exec('begin;');
 assert.equal(await rpc('icash_record_owner_batch_receipt',account,batch,error.raw),true);
 assert.equal(await rpc('icash_record_owner_batch_receipt',account,batch,error.raw),true);
 assert.equal(await v('select receipt from icash_research_private.owner_exports where id=$1',[batch]),null);
 assert.equal(await rpc('icash_owner_active_export_capacity'),'export_busy');
 assert.equal(await newAdmission(),'export_busy');
 assert.equal(await v("select evidence->>'kind' from icash_research_private.unknown_export_late_holds"),'batch_receipt');
 assert.equal(await rpc('icash_record_owner_export_receipt',account,batch,error),true,'Full later receipt does not conflict with first late observation');
 assert.equal(await v('select count(*)::integer from icash_research_private.unknown_export_late_holds'),1);
 assert.deepEqual(await originalMoney(),money);await db.exec('rollback;');

 for(const role of ['anon','authenticated','service_role']){
  assert.equal(await v("select has_table_privilege($1,'icash_research_private.unknown_export_late_holds','select')",[role]),false);
  for(const name of ['guard_unknown_export_late_hold','unknown_export_late_capacity_blocked','guard_export_capacity_binding','observe_unknown_export_late_batch'])assert.equal(await v('select has_function_privilege($1,$2,\'execute\')',[role,'icash_research_private.'+name+'()']),false);
 }
 // Exact predecessor extraction retains every unrelated admission predicate.
 const admission=await v("select pg_get_functiondef('public.icash_admit_owner_active_export(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb)'::regprocedure)");
 assert(admission.includes('public.icash_owner_targeting_pool'));
 assert(admission.includes('public.icash_admit_owner_batch'));
 assert(admission.includes("match->'is_likely_renter'"));
 console.log('PASS unknown-export late evidence: exact production writers, terminal/nonterminal/null responses, independent batch path, newer pending export, immutable review/money/owner fences, admission/monitoring and private ACLs.');
}finally{await db.close();}
