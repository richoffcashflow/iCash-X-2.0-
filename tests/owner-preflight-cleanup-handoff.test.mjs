import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {preflightOwnerExport,OwnerPreflightCleanupPendingError} from '../lib/owner-export-preflight.ts';
import {setupSql,seedSql,migration,enableSql,id,read} from './helpers/owner-preflight-cleanup-fixture.mjs';
const pg=new PGlite(),q=(s,a=[])=>pg.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const seed=(n,t=true)=>v('select fixture_cleanup_seed($1,$2)',[n,t]);
const claim=c=>v('select icash_claim_owner_preflight($1,$2,$3)',[c.account,JSON.stringify(c.items),JSON.stringify(c.request)]);
const admit=(c,n)=>v('select icash_admit_owner_preflight_cleanup($1,$2,$3)',[c.account,c.preflight,id(n)]);
const row=c=>v('select to_jsonb(p) from icash_research_private.owner_export_preflights p where id=$1',[c.preflight]);
const immutable=p=>Object.fromEntries(['id','account_id','created_at','started_at','checked_at','next_check_at','list_id','list_name','fingerprint','items','request','receipts','generation','supersedes'].map(k=>[k,p[k]]));
process.env.DEALMACHINE_API_KEY='dm_sk_live_offline_fixture';
function service(c,{denyReceipt=false,loseAdmission=false,transportError=false}={}){
 const calls=[],rpcs=[];
 const db=async(path,_method,b)=>{
  rpcs.push(path);
  if(path==='rpc/icash_finish_dealmachine_request')return true;
  if(path==='rpc/icash_claim_owner_preflight_cleanup')return null;
  if(denyReceipt&&path==='rpc/icash_record_owner_preflight_cleanup')return false;
  const keys=Object.keys(b),args=Object.values(b).map(x=>x&&typeof x==='object'?JSON.stringify(x):x);
  const result=await v(`select public.${path.slice(4)}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')})`,args);
  if(loseAdmission&&path==='rpc/icash_admit_owner_preflight_cleanup')throw Error('LOST_ADMISSION_ACK');
  return result;
 };
 const transport=async(url,opts)=>{
  calls.push([url,opts.method]);assert(!url.includes('/people/export'),'No paid export in cleanup recovery');
  if(transportError)throw Error('UNKNOWN_DELETE');
  if(opts.method==='DELETE')return Response.json({data:{deleted:true}});
  assert.equal(opts.method,'POST');assert.equal(url,'https://api.v2.dealmachine.com/v1/lists');
  const body=JSON.parse(opts.body);return Response.json({data:{list_id:'fresh-'+body.name,name:body.name,source_type:'people',status:'completed',total_count:1}});
 };
 return {calls,rpcs,run:()=>preflightOwnerExport(db,c.account,c.items,c.request,transport)};
}
try{
 await pg.exec(setupSql);await pg.exec(seedSql);
 const original=await seed(6101),before=immutable(await row(original));
 assert.equal((await claim(original)).status,'held','Reproduce expired known list dropping out before targeted cleanup');
 const fifo=await v("select pg_get_functiondef('icash_claim_owner_preflight_cleanup(uuid)'::regprocedure)");
 await pg.exec('begin;'+migration+'commit;');assert.equal(migration,read('supabase/migrations/20261114212434_owner_preflight_cleanup_handoff.sql'));
 assert.equal((await claim(original)).status,'held','Inactive rollout preserves baseline');
 await pg.exec(enableSql);
 assert.equal((await claim(original)).status,'cleanup_required');
 assert.deepEqual(immutable(await row(original)),before,'Read-only cleanup hint preserves all original evidence');
 assert.equal(await v('select icash_enrichment_candidate($1)',[original.account]),original.screening,'Existing rate-limited original remains ordinary-selector eligible');
 const noTicket=await seed(6102,false);assert.equal(await v('select icash_enrichment_candidate($1)',[noTicket.account]),noTicket.screening,'No-ticket original remains ordinary-selector eligible');
 const run=service(original);assert.equal((await run.run()).status,'pending');
 assert.deepEqual(run.calls.map(c=>c[1]),['DELETE','POST'],'Confirmed exact original deletion permits one ordinary fresh creation');
 assert.equal(run.rpcs.filter(x=>x==='rpc/icash_claim_owner_preflight').length,2);
 assert.equal(await v('select count(*)::int from icash_research_private.owner_export_preflights where supersedes=$1',[original.preflight]),1);
 assert.deepEqual(immutable(await row(original)),before,'Original TTL, receipts, fingerprint and source never change');
 const child=await v('select to_jsonb(p) from icash_research_private.owner_export_preflights p where supersedes=$1',[original.preflight]);
 assert.equal(child.state,'waiting');assert.equal(child.generation,2);assert.equal(child.cleanup_attempts,0);
 const noTicketService=service(noTicket);assert.equal((await noTicketService.run()).status,'pending');assert.deepEqual(noTicketService.calls.map(c=>c[1]),['DELETE','POST'],'The no-ticket original follows the same confirmed cleanup and ordinary renewal');
 for(const options of [{denyReceipt:true},{transportError:true},{loseAdmission:true}]){
  const c=await seed(6200+Object.keys(options)[0].length),originalRow=immutable(await row(c)),s=service(c,options);
  await assert.rejects(s.run(),OwnerPreflightCleanupPendingError);
  assert.equal(s.calls.length,options.loseAdmission?0:1);
  assert.equal((await row(c)).deleted_at,null);assert.equal((await row(c)).cleanup_attempts,1);
  assert.deepEqual(immutable(await row(c)),originalRow);
  assert.equal(await v('select count(*)::int from icash_research_private.owner_export_preflights where supersedes=$1',[c.preflight]),0);
  const again=service(c);await assert.rejects(again.run(),OwnerPreflightCleanupPendingError);assert.equal(again.calls.length,0,'Active cleanup lease never repeats DELETE');
 }
 const quota=await seed(6301);await pg.exec('update fixture_cleanup_policy set quota=false');
 const denied=service(quota);await assert.rejects(denied.run(),OwnerPreflightCleanupPendingError);assert.equal(denied.calls.length,0);
 assert.equal((await row(quota)).cleanup_attempts,0,'Local quota denial consumes no cleanup attempt');
 assert.equal(await v('select count(*)::int from icash_research_private.owner_preflight_cleanup_admissions where preflight_id=$1',[quota.preflight]),0);
 await pg.exec('update fixture_cleanup_policy set quota=true');
 const a=await admit(quota,8001);assert.equal(a.status,'admitted');assert.equal((await admit(quota,8001)).status,'pending');
 assert.equal((await row(quota)).cleanup_attempts,1);
 // Dedicated wait uses the original token and bounded ordinary retry mechanism.
 await q("update icash_automation_tickets set state='consumed',token='exact-current-token',expires_at=now()+interval '5 minutes' where id=$1",[quota.ticket]);
 const defer=token=>v('select icash_defer_owner_preflight_cleanup($1,$2,$3,$4,$5,$6)',[quota.ticket,quota.account,quota.screening,token,`owners:${quota.account}:${quota.screening}`,quota.preflight]);
 assert.equal(await defer('wrong-token'),false);assert.equal(await defer('exact-current-token'),true);
 const ticket=await v('select to_jsonb(t) from icash_automation_tickets t where id=$1',[quota.ticket]);
 assert.equal(ticket.owner_preview_deferrals,3);assert.equal(ticket.outcome,'owner_preview_rate_limited');
 assert(new Date(ticket.owner_preview_retry_until)<Date.now()+21*3600e3,'Original source deadline is not extended');
 for(const [n,mutation] of [
  [6401,c=>q('update icash_accounts set bot_paused=true where id=$1',[c.account])],
  [6402,c=>q('update icash_wallets set balance_cents=0 where account_id=$1',[c.account])],
  [6403,c=>q("update icash_screening_jobs set snapshot=jsonb_set(snapshot,'{propertyId}','\"changed\"') where id=$1",[c.screening])],
  [6404,c=>q("update icash_screening_jobs set completed_at=now()-interval '25 hours' where id=$1",[c.screening])],
 ]){const c=await seed(n);await mutation(c);assert.equal((await admit(c,n+1000)).status,'held');assert.equal((await row(c)).cleanup_attempts,0);}
 assert.equal(await v("select pg_get_functiondef('icash_claim_owner_preflight_cleanup(uuid)'::regprocedure)"),fifo,'Global FIFO function is byte-for-byte unchanged');
 for(const role of ['anon','authenticated'])assert.equal(await v("select has_function_privilege($1,'icash_admit_owner_preflight_cleanup(uuid,uuid,uuid)','execute')",[role]),false);
 assert.equal(await v("select has_table_privilege('service_role','icash_research_private.owner_preflight_cleanup_admissions','update')"),false);
 await assert.rejects(q('update icash_research_private.owner_preflight_cleanup_admissions set token=$1 where request_id=$2',[id(9999),id(8001)]),/immutable/);
 console.log('PASS cleanup handoff: expired baseline, ordinary held/no-ticket selection, exact DELETE then one normal renewal, immutable evidence, unknown/false/lost receipts, busy lease, quota-before-attempt, bounded source-bound deferral, source/Pause/funds/TTL guards and unchanged FIFO.');
}catch(e){console.error(e.message,e.where??'');process.exitCode=1;}finally{await pg.close();}
