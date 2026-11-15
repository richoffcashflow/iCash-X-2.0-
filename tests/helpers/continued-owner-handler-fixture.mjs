import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {enrichActiveOwners,activeOwnerExportRequest} from '../../lib/owner-active-export.ts';
import {installContinuedSchedulingFixture,value,read,issue} from './continued-owner-scheduling-fixture.mjs';
export {value,read,issue};
export const captured=JSON.parse(read('tests/fixtures/continued-owner-handler-before.json'));
const uuid=s=>{const h=createHash('md5').update(s).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};

export async function installContinuedHandlerFixture(db){
 await installContinuedSchedulingFixture(db);
 for(const entry of captured){
  const present=await value(db,'select to_regprocedure($1)::text',[entry.signature]);
  if(present&&entry.signature!=='public.icash_consume_automation(text)')
   assert.equal(await value(db,'select md5(pg_get_functiondef($1::regprocedure))',[entry.signature]),entry.md5,`Actual ${entry.signature} predecessor must match production capture`);
  await db.exec(entry.definition);
 }
 await db.exec(`revoke all on function public.icash_owner_batch_candidates(uuid,uuid),public.icash_owner_targeting_pools(uuid,uuid[]),public.icash_consume_automation(text) from public,anon,authenticated;
 grant execute on function public.icash_owner_batch_candidates(uuid,uuid),public.icash_owner_targeting_pools(uuid,uuid[]),public.icash_consume_automation(text) to service_role;
 revoke all on function icash_research_private.owner_preflight_cohort(uuid,uuid) from public,anon,authenticated,service_role;`);
 await db.exec(`alter table public.fixture_cleanup_policy add column outreach_floor bigint not null default 0;
 create or replace function public.icash_prospecting_outreach_floor(uuid) returns bigint language sql stable as $$select outreach_floor from public.fixture_cleanup_policy$$;
 create function public.icash_finish_dealmachine_request(p_request uuid,p_result jsonb) returns boolean language plpgsql as $$begin
 update icash_research_private.requests set finished_at=clock_timestamp(),result=p_result where id=p_request;
 return found;end$$;`);
 for(const name of ['continued-owner-scheduling','owner-wait-admission','owner-expired-checking-eligibility'])await db.exec('begin;'+read('config/'+name+'.sql')+'commit;');
 // Exact production final batch/active-export guards and preflight recorders.
 // The shared handler rehearsal separately installs their real financial
 // dependencies; migration-only tests can use this smaller source fixture.
 await db.exec(`create table icash_research_private.owner_batches(id uuid primary key,account_id uuid,primary_screening uuid,items jsonb,preview_receipt jsonb);
 create table icash_research_private.owner_batch_items(screening_id uuid primary key,batch_id uuid,operation_key text);`);
 for(const entry of JSON.parse(read('tests/fixtures/continued-owner-handler-final.json'))){
  await db.exec(entry.definition);
  assert.equal(await value(db,'select md5(pg_get_functiondef($1::regprocedure))',[entry.signature]),entry.md5);
 }
}

// Construct complete synthetic original history before creating the immutable
// continuation journal. Every tested selection/claim uses production guards.
export async function seedHandlerOriginal(db,n,{size=3,siblingTickets=false,competitors=true,checking=false,cleanup=true,prepareFinancial=null}={}){
 const c=await value(db,`select public.${checking?'fixture_expired_checking_seed':'fixture_expired_ticket_seed'}($1)`,[n]);
 if(prepareFinancial)await prepareFinancial(db,c);
 const first=await value(db,'select snapshot from public.icash_screening_jobs where id=$1',[c.screening]);
 const items=[];
 for(let i=0;i<size;i++){
  const screening=i===0?c.screening:`ffffffff-ffff-4fff-8fff-${String(n*10+i).padStart(12,'0')}`;
  const property='prop_'+(n*10+i);
  const snapshot={...first,propertyId:property,sellerCostReserveCents:100000,raw:{data:{dm_property_id:property,state:'TX',zip:'75217',full_address:'Synthetic handler fixture',estimated_value:200000,estimated_repair_cost:40000,total_estimated_loan_balance:50000}}};
  if(i===0)await db.query('update public.icash_screening_jobs set snapshot=$1 where id=$2',[snapshot,screening]);
  else await db.query("insert into public.icash_screening_jobs(id,account_id,event_key,snapshot,state,result,completed_at) values($1,$2,$3,$4,'complete','{\"financialCheck\":{\"status\":\"eligible\"},\"fixtureScore\":1}',now()-interval '1 hour')",[screening,c.account,`synthetic-handler-${n}-${i}`,snapshot]);
  items.push({screeningId:screening,snapshot,ids:['per_'+(n*10+i)]});
  if(i>0&&siblingTickets)await db.query("insert into public.icash_automation_tickets(id,account_id,kind,screening_id,state,outcome,created_at,completed_at,expires_at) values($1,$2,'contacts',$3,'held','held',now()-interval '1 hour',now()-interval '59 minutes',now()-interval '59 minutes')",[uuid(`handler-sibling-ticket-${n}-${i}`),c.account,screening]);
 }
 if(competitors)for(let i=0;i<5;i++){
  const screening=`00000000-0000-4000-8000-${String(n*10+i).padStart(12,'0')}`,property='prop_'+(n*100+i);
  const snapshot={...items[0].snapshot,propertyId:property,raw:{data:{...items[0].snapshot.raw.data,dm_property_id:property}}};
  await db.query("insert into public.icash_screening_jobs(id,account_id,event_key,snapshot,state,result,completed_at) values($1,$2,$3,$4,'complete','{\"financialCheck\":{\"status\":\"eligible\"},\"fixtureScore\":0}',now()-interval '1 hour')",[screening,c.account,`synthetic-handler-competitor-${n}-${i}`,snapshot]);
 }
 // The immutable original order intentionally differs from UUID ordering.
 // A batch implementation that silently sorts the siblings must fail rehearsal.
 if(items.length>2)items.splice(1,items.length-1,...items.slice(1).reverse());
 const request=activeOwnerExportRequest(items.flatMap(x=>x.ids),false,true);
 await db.exec('alter table icash_research_private.owner_export_preflights disable trigger owner_preflight_immutable');
 await db.query(`update icash_research_private.owner_export_preflights set items=$2,request=$3,fingerprint=md5(jsonb_build_array($2::jsonb,$3::jsonb)::text),
 receipts=jsonb_build_object('create',jsonb_build_object('httpStatus',200,'raw',jsonb_set(receipts->'create'->'raw','{data,total_count}',to_jsonb($4::integer)),
 'rawText',jsonb_set(receipts->'create'->'raw','{data,total_count}',to_jsonb($4::integer))::text)) where id=$1`,[c.preflight,JSON.stringify(items),request,size]);
 if(checking){
  const raw={total_people:size,total_results:size,total_properties:size};
  await db.query("update icash_research_private.owner_export_preflights set receipts=receipts||jsonb_build_object('baseline',$2::jsonb) where id=$1",[c.preflight,{httpStatus:200,raw,rawText:JSON.stringify(raw)}]);
  await db.exec('alter table icash_research_private.owner_preflight_quota_deferrals disable trigger owner_preflight_quota_immutable');
  await db.query('update icash_research_private.owner_preflight_quota_deferrals d set receipts_hash=md5(p.receipts::text) from icash_research_private.owner_export_preflights p where d.preflight_id=p.id and p.id=$1',[c.preflight]);
  await db.exec('alter table icash_research_private.owner_preflight_quota_deferrals enable trigger owner_preflight_quota_immutable');
 }
 await db.exec('alter table icash_research_private.owner_export_preflights enable trigger owner_preflight_immutable');
 await db.query('delete from icash_research_private.owner_export_preflight_items where preflight_id=$1',[c.preflight]);
 for(const item of items)await db.query('insert into icash_research_private.owner_export_preflight_items values($1,$2,$3,md5($4::jsonb::text))',[c.preflight,c.account,item.screeningId,item.snapshot]);
 await db.query("update public.icash_automation_tickets t set owner_preview_retry_until=now()+interval '20 minutes',owner_preview_screening_hash=public.icash_owner_enrichment_screening_hash(s) from public.icash_screening_jobs s where t.screening_id=s.id and t.id=$1",[c.ticket]);
 const continued=await value(db,'select public.icash_continue_expired_owner_preflight_ticket()');assert.equal(continued.ticketId,c.ticket);
 if(cleanup){
  const claim=checking?await value(db,'select public.icash_admit_expired_checking_cleanup($1,$2,gen_random_uuid())',[c.account,c.preflight]):await value(db,'select public.icash_claim_owner_preflight_cleanup($1)',[c.preflight]);assert(claim?.token);
  assert.equal(await value(db,'select public.icash_record_owner_preflight_cleanup($1,$2,$3)',[c.preflight,claim.token,{httpStatus:200,raw:{data:{deleted:true}},rawText:'{"data":{"deleted":true}}'}]),true);
 }
 await db.query("update public.icash_discovery_configs set next_run_at=now()-interval '1 minute' where account_id=$1",[c.account]);
 const config=await value(db,'select to_jsonb(c) from public.icash_discovery_configs c where account_id=$1',[c.account]);
 const listId=await value(db,'select list_id from icash_research_private.owner_export_preflights where id=$1',[c.preflight]);
 return {...c,items,request,config,listId};
}

const rpcTypes={
 icash_owner_active_export_capacity:{p_account:'uuid'},
 icash_owner_preflight_step_capacity:{p_account:'uuid',p_screening:'uuid'},
 icash_owner_batch_candidates:{p_account:'uuid',p_screening:'uuid'},
 icash_owner_targeting_pools:{p_account:'uuid',p_screenings:'uuid[]'},
 icash_continued_owner_preflight:{p_account:'uuid',p_primary:'uuid',p_candidates:'jsonb',p_mobile:'boolean'},
 icash_pending_owner_preflight:{p_account:'uuid',p_primary:'uuid',p_candidates:'jsonb',p_mobile:'boolean'},
 icash_claim_owner_preflight:{p_account:'uuid',p_items:'jsonb',p_request:'jsonb'},
 icash_take_dealmachine_request:{p_kind:'text',p_account:'uuid',p_operation:'text',p_request:'uuid'},
 icash_finish_dealmachine_request:{p_request:'uuid',p_result:'jsonb'},
 icash_record_owner_preflight:{p_id:'uuid',p_lease:'uuid',p_step:'text',p_receipt:'jsonb'},
 icash_claim_owner_preflight_cleanup:{p_id:'uuid'},
 icash_record_owner_preflight_cleanup:{p_id:'uuid',p_token:'uuid',p_receipt:'jsonb'},
 icash_admit_expired_checking_cleanup:{p_account:'uuid',p_id:'uuid',p_request:'uuid'},
 icash_admit_owner_preflight_cleanup:{p_account:'uuid',p_id:'uuid',p_request:'uuid'},
 icash_admit_owner_active_export:{p_account:'uuid',p_primary:'uuid',p_batch:'uuid',p_items:'jsonb',p_preview:'jsonb',p_config:'jsonb',p_request:'jsonb'},
};
export class SyntheticFinalClaimReached extends Error {
 constructor(){super('SYNTHETIC_FINAL_CLAIM_REACHED');this.name='SyntheticFinalClaimReached';}
}
export function handlerBoundary(pg,c,{beforeRpc=null,finalQuota=false,stopAfterFinalClaim=false,recoverFinalFailure=false}={}){
 const calls=[],rpcCalls=[];
 const db=async(path,method,payload)=>{
  assert.equal(method,'POST');const name=path.replace(/^rpc\//,'');const types=rpcTypes[name];assert(types,`Unexpected paid or unsupported boundary ${path}`);
  rpcCalls.push({name,payload:structuredClone(payload)});if(beforeRpc)await beforeRpc(name,payload);
  if(name==='icash_admit_owner_active_export')await pg.query('update public.fixture_cleanup_policy set quota=$1',[finalQuota]);
  const fields=Object.keys(payload);for(const key of fields)assert(types[key],`Unknown actual RPC argument ${key}`);
  const finalSavepoint=name==='icash_admit_owner_active_export'&&recoverFinalFailure;
  if(finalSavepoint)await pg.query('savepoint fixture_final_guard');
  let result;
  try{
   result=await value(pg,`select public.${name}(${fields.map((key,i)=>`${key}=>$${i+1}::${types[key]}`).join(',')})`,fields.map(key=>types[key]==='jsonb'?JSON.stringify(payload[key]):payload[key]));
  }catch(error){
   // Recover only the failed final SQL statement, retaining the just-recorded
   // synthetic late control so tests can inspect atomic no-partial admission.
   if(finalSavepoint)await pg.query('rollback to savepoint fixture_final_guard');
   throw error;
  }finally{if(finalSavepoint)await pg.query('release savepoint fixture_final_guard');}
  rpcCalls.at(-1).result=structuredClone(result);
  // Stop only after the real SQL has returned claimed. No fabricated success
  // reaches the handler and no transport can dispatch the admitted operation.
  if(name==='icash_admit_owner_active_export'&&result==='claimed'&&stopAfterFinalClaim)throw new SyntheticFinalClaimReached();
  return result;
 };
 const transport=async(url,init)=>{
  calls.push({url:String(url),method:init.method,body:init.body?JSON.parse(init.body):null});
  const path=String(url).replace('https://api.v2.dealmachine.com/v1','');
  if(path==='/lists'&&init.method==='POST'){
   const body=JSON.parse(init.body);assert.deepEqual(body.record_ids,c.items.flatMap(x=>x.ids).map(x=>Number(x.slice(4))));
   return Response.json({data:{list_id:'synthetic-child-'+c.preflight,name:body.name,source_type:'people',status:'completed',total_count:body.record_ids.length}});
  }
  if(path==='/people/search/count'&&init.method==='POST')return Response.json({total_people:c.items.length,total_results:c.items.length,total_properties:c.items.length});
  if(path==='/lists/synthetic-child-'+c.preflight&&init.method==='DELETE')return Response.json({data:{deleted:true}});
  if(path==='/lists/'+c.listId&&init.method==='DELETE')return Response.json({data:{deleted:true}});
  if(path==='/properties/ids'&&init.method==='POST'){
   assert.deepEqual(JSON.parse(init.body).ids,c.items.map(i=>i.snapshot.propertyId));
   return Response.json({data:c.items.map(i=>({dm_property_id:i.snapshot.propertyId,found:true,contacts:i.ids.map(dm_person_id=>({dm_person_id,contact_type:'owner',is_likely_owner:true,availability:{phones:1}}))})),
    totals:{submitted:c.items.length,found:c.items.length,not_found:0},credits:{used:0,people:0,properties:0,deduplicated:0}});
  }
  assert.fail('Unexpected synthetic transport: '+path+' '+init.method);
 };
 const config={...c.config,research_version:2};
 return {calls,rpcCalls,run:()=>enrichActiveOwners(db,c.account,c.items[0],config,250000,transport)};
}

export async function issueAndConsume(pg,c){
 const selected=await issue(pg);assert.equal(selected?.id,c.ticket,'The actual acquisition selector must issue this original');
 const consumed=await value(pg,'select public.icash_consume_automation($1)',[selected.token]);
 assert.equal(consumed.id,c.ticket);assert.equal(consumed.screeningId,c.screening);
 assert.equal(await value(pg,'select state from public.icash_automation_tickets where id=$1',[c.ticket]),'consumed');
 return selected;
}
