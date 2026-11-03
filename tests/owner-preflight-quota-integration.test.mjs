import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {preflightOwnerExport} from '../lib/owner-export-preflight.ts';
import {setupIndexingFixture,read} from './fixtures/owner-preflight-indexing-setup.mjs';
const pg=new PGlite(),q=(s,a=[])=>pg.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const receipt=raw=>({httpStatus:200,raw,rawText:JSON.stringify(raw)}),count=n=>receipt({total_people:n,total_results:n,total_properties:n});
const metadata=(c,status='completed',n=1)=>receipt({data:{list_id:'list-'+c.id,name:c.name,source_type:'people',status,total_count:n}});
const claim=c=>v('select icash_claim_owner_preflight($1,$2,$3)',[c.account,c.items,c.request]);
const record=(c,step,r)=>v('select icash_record_owner_preflight($1,$2,$3,$4)',[c.id,c.lease,step,r]);
const due=c=>q("update icash_research_private.owner_export_preflights set next_check_at=now()-interval '1 second' where id=$1",[c.id]);
const denialDue=()=>pg.exec("alter table icash_research_private.owner_preflight_quota_deferrals disable trigger owner_preflight_quota_immutable;update icash_research_private.owner_preflight_quota_deferrals set created_at=now()-interval '31 seconds';alter table icash_research_private.owner_preflight_quota_deferrals enable trigger owner_preflight_quota_immutable");
async function seed(n){const c=await v('select fixture_preflight_seed($1,false)',[n]);c.items=[{screeningId:c.screening,snapshot:await v('select snapshot from icash_screening_jobs where id=$1',[c.screening]),ids:['per_'+n]}];c.request={people_ids:['per_'+n],mobile_only:false,property_match:'owner',anchor:'person',require_phone:true,scrub_dnc:true,active_phones_only:true};return {...c,...await claim(c)};}
try{
 await setupIndexingFixture(pg);
 await pg.exec(read('config/owner-preflight-list-indexing.sql'));
 await pg.exec('create table icash_research_private.requests(id uuid primary key,kind text,account_id uuid,operation_key text,admitted boolean,created_at timestamptz default clock_timestamp(),finished_at timestamptz,result jsonb)');
 const pruning=read('config/research-request-efficiency.sql');await pg.exec(pruning.slice(pruning.indexOf('create function public.icash_prune_research_requests()'),pruning.indexOf('revoke all on function public.icash_research_efficiency_summary')));
 const original=await v("select pg_get_functiondef('icash_claim_owner_preflight(uuid,jsonb,jsonb)'::regprocedure)");
 await pg.exec(read('config/owner-preflight-quota-recovery.sql'));
 assert.equal(await v('select preflight_quota_recovery_enabled from icash_research_private.owner_export_settings'),false);
 const updated=await v("select pg_get_functiondef('icash_claim_owner_preflight(uuid,jsonb,jsonb)'::regprocedure)");
 const quotaSql=read('config/owner-preflight-quota-recovery.sql'),locks=quotaSql.split('$locks$')[1];
 const restored=updated.replace('declare quota_result jsonb;p icash_research_private.owner_export_preflights;','declare p icash_research_private.owner_export_preflights;').replace('\n  quota_result:=icash_research_private.owner_preflight_quota_resume(p.id,p_items,p_request);\n  if quota_result is not null then return quota_result;end if;','').replace(locks,'');
 assert.equal(restored,original,'Every original current claim predicate and lock remains unchanged outside the two explicit quota hooks');
 assert.ok(updated.includes('owner_preflight_quota_resume'));assert.ok(updated.includes('indexing_checks=indexing_checks+case'),'Preserve indexed current claim');
 assert.ok(original.includes('owner_preflight_renewable'));assert.ok(updated.includes('owner_preflight_renewable'),'Preserve deployed immutable renewal');
 await pg.exec('update icash_research_private.owner_export_settings set preflight_indexing_enabled=true,preflight_quota_recovery_enabled=true');
 for(const [n,deniedStep] of [[9001,'metadata'],[9002,'baseline'],[9003,'eligible']]){
  const c=await seed(n);assert.equal(await record(c,'create',metadata(c,'idle',0)),'pending');await due(c);
  let deny=true;const calls=[];
  const db=async(path,_method,p)=>{
   if(path==='rpc/icash_claim_owner_preflight')return claim(c);
   if(path==='rpc/icash_take_dealmachine_request'){
    const blocked=deny&&p.p_operation.endsWith(':'+deniedStep);
    await q('insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,result) values($1,$2,$3,$4,$5,$6)',[p.p_request,p.p_kind,p.p_account,p.p_operation,!blocked,blocked?{outcome:'quota_wait'}:null]);return !blocked;
   }
   if(path==='rpc/icash_finish_dealmachine_request')return true;
   if(path==='rpc/icash_defer_owner_preflight_quota')return v('select icash_defer_owner_preflight_quota($1,$2,$3,$4)',[p.p_id,p.p_lease,p.p_step,p.p_request]);
   if(path==='rpc/icash_record_owner_preflight')return v('select icash_record_owner_preflight($1,$2,$3,$4)',[p.p_id,p.p_lease,p.p_step,p.p_receipt]);
   if(path==='rpc/icash_claim_owner_preflight_cleanup')return null;
   throw Error(path);
  };
  const transport=async(url,o)=>{const step=o.method==='GET'?'metadata':JSON.parse(o.body).filters?'eligible':'baseline';calls.push(step);return Response.json(step==='metadata'?metadata(c).raw:count(1).raw);};
  const run=()=>preflightOwnerExport(db,c.account,c.items,c.request,transport);
  assert.equal((await run()).status,'pending',deniedStep+' local refusal should defer');
  const saved=await v('select receipts from icash_research_private.owner_export_preflights where id=$1',[c.id]);assert.equal(saved[deniedStep],undefined);
  await denialDue();
  // Actual installed retry-current predicate must still reject reserved funds,
  // membership loss and a late original paid operation before rotating a lease.
  await q('update icash_wallets set reserved_cents=balance_cents where account_id=$1',[c.account]);assert.equal((await claim(c)).status,'held');await q('update icash_wallets set reserved_cents=0 where account_id=$1',[c.account]);
  await pg.exec('update fixture_cleanup_policy set member=false');assert.equal((await claim(c)).status,'held');await pg.exec('update fixture_cleanup_policy set member=true');
  deny=false;assert.equal((await run()).status,'ready');
  assert.deepEqual(calls,['metadata','baseline','eligible'],'Only denied step resumes; original successful free steps never replay');
  const final=await v('select receipts from icash_research_private.owner_export_preflights where id=$1',[c.id]);for(const [key,r] of Object.entries(saved))assert.deepEqual(final[key],r);
 }
 assert.equal(await v('select count(*)::int from icash_operation_spend'),0);assert.equal(await v('select count(*)::int from icash_credit_reservations'),0);
 console.log('PASS integrated current preflight/indexing/quota service: exact metadata, baseline and eligible local denials resume once, existing admission gates/immutable evidence remain, reserved funds and membership block.');
}finally{await pg.close();}
