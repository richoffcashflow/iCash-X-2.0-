import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {preflightOwnerExport} from '../lib/owner-export-preflight.ts';
import {setupIndexingFixture,read,reviewed} from './fixtures/owner-preflight-indexing-setup.mjs';
const pg=new PGlite(),q=(s,a=[])=>pg.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const receipt=raw=>({httpStatus:200,raw,rawText:JSON.stringify(raw)});
const row=c=>v('select to_jsonb(p) from icash_research_private.owner_export_preflights p where id=$1',[c.id]);
const record=(c,step,r)=>v('select icash_record_owner_preflight($1,$2,$3,$4)',[c.id,c.lease,step,r]);
const count=n=>receipt({total_people:n,total_results:n,total_properties:n,credits:{used:0}});
const metadata=(c,status='completed',total=1)=>receipt({data:{list_id:'list-'+c.id,name:c.name,source_type:'people',status,total_count:total}});
const claim=c=>v('select icash_claim_owner_preflight($1,$2,$3)',[c.account,c.items,c.request]);
const due=c=>q('update icash_research_private.owner_export_preflights set next_check_at=now()-interval \'1 second\' where id=$1',[c.id]);
async function seed(n){
 const c=await v('select fixture_preflight_seed($1,false)',[n]);
 const snapshot=await v('select snapshot from icash_screening_jobs where id=$1',[c.screening]);
 c.items=[{screeningId:c.screening,snapshot,ids:['per_'+n]}];
 c.request={people_ids:['per_'+n],mobile_only:false,property_match:'owner',anchor:'person',require_phone:true,scrub_dnc:true,active_phones_only:true};
 return {...c,...await claim(c)};
}
async function pause(c,fn){await q('update icash_accounts set bot_paused=true where id=$1',[c.account]);try{await fn();}finally{await q('update icash_accounts set bot_paused=false where id=$1',[c.account]);}}
try{
 await setupIndexingFixture(pg);
 for(const [signature,{hash}] of Object.entries(reviewed))assert.equal(await v('select md5(pg_get_functiondef($1::regprocedure))',[signature]),hash);
 const before=await seed(2001);assert.equal(await record(before,'create',metadata(before,'idle',0)),'held','Reproduce exact idle creation prematurely held');
 assert.ok(await v('select icash_claim_owner_preflight_cleanup($1)',[before.id]),'Old path immediately deletes the confirmed pending list');
 const baseline=await seed(2002);await record(baseline,'create',metadata(baseline));await due(baseline);Object.assign(baseline,await claim(baseline));
 assert.equal(await record(baseline,'baseline',count(0)),'held','Reproduce lagging search index treated as a permanent failed check');
 const migration=read('config/owner-preflight-list-indexing.sql');assert.equal(migration,read('supabase/migrations/20261103055516_owner_preflight_list_indexing.sql'));await pg.exec(migration);
 assert.equal(await v('select preflight_indexing_enabled from icash_research_private.owner_export_settings'),false);
 const disabled=await seed(2003);assert.equal(await record(disabled,'create',metadata(disabled,'idle',0)),'held','Compatible deployment stays disabled until matching releases');
 await pg.exec('update icash_research_private.owner_export_settings set preflight_indexing_enabled=true');
 const c=await seed(2004),original=metadata(c,'idle',0);assert.equal(await record(c,'create',original),'pending');
 assert.equal((await claim(c)).status,'pending');assert.equal(await v('select icash_claim_owner_preflight_cleanup($1)',[c.id]),null);
 assert.equal(await v('select icash_research_private.owner_preflight_list_known($1,true)',[c.id]),false);
 await due(c);Object.assign(c,await claim(c));assert.equal(c.nextStep,'metadata');
 assert.equal(await record(c,'baseline',count(1)),'held','An older service cannot skip required canonical metadata');
 const building=metadata(c,'building',0);assert.equal(await record(c,'metadata',building),'pending');
 assert.equal(await record(c,'metadata',building),'pending','Lost acknowledgement only acknowledges identical bytes');
 assert.equal(await record(c,'metadata',metadata(c,'building',1)),'held','Contradictory acknowledgement cannot replace old receipt');
 await due(c);Object.assign(c,await claim(c));assert.equal(await record(c,'metadata',metadata(c)),'checking');
 assert.equal(await record(c,'baseline',count(0)),'pending','Zero baseline is indexing wait, never zero eligible owners');
 const waiting=await row(c);assert.equal(waiting.state,'waiting');assert.equal(waiting.indexing_next_step,'baseline');
 assert.equal(waiting.receipts.baseline,undefined);assert.deepEqual(waiting.receipts.create,original);
 assert.equal(await v('select icash_claim_owner_preflight_cleanup($1)',[c.id]),null);
 await due(c);await pause(c,async()=>assert.equal((await claim(c)).status,'held','Customer Pause wins a due count'));
 Object.assign(c,await claim(c));assert.equal(c.nextStep,'baseline');assert.equal(await record(c,'baseline',count(1)),'checking');
 assert.equal(await record(c,'eligible',count(1)),'ready');assert.equal(await v('select icash_research_private.owner_preflight_ready_current($1)',[c.id]),true);
 const final=await row(c);for(const [key,r] of Object.entries(waiting.receipts))assert.deepEqual(final.receipts[key],r,'Prior original observations immutable');
 assert.equal(final.indexing_next_step,null);assert.equal(final.indexing_reason,null);
 assert.ok(await v('select icash_claim_owner_preflight_cleanup($1)',[c.id]),'Only terminal evidence allows ordinary cleanup');
 await assert.rejects(q("update icash_research_private.owner_export_preflights set receipts=receipts-'create' where id=$1",[c.id]),/immutable/);
 for(const [n,mutate] of [[2010,r=>r.raw.data.list_id='foreign'],[2011,r=>r.raw.data.name='foreign'],[2012,r=>r.raw.data.source_type='properties'],[2013,r=>r.raw.data.status='failed'],[2014,r=>r.raw.credits={used:1}],[2015,r=>r.raw.data.total_count=2]]){
  const bad=await seed(n);await record(bad,'create',metadata(bad,'idle',0));await due(bad);Object.assign(bad,await claim(bad));let r=metadata(bad);mutate(r);r.rawText=JSON.stringify(r.raw);
  assert.equal(await record(bad,'metadata',r),'held');assert.equal((await row(bad)).indexing_reason,'provider_list_status_invalid');
 }
 const capped=await seed(2020);await record(capped,'create',metadata(capped,'idle',0));
 for(let i=1;i<=6;i++){await due(capped);Object.assign(capped,await claim(capped));assert.equal(capped.nextStep,'metadata');assert.equal(await record(capped,'metadata',metadata(capped,'idle',0)),i===6?'held':'pending');}
 assert.equal((await row(capped)).indexing_reason,'provider_indexing_exhausted');assert.equal((await claim(capped)).status,'held');
 assert.equal(Object.keys((await row(capped)).receipts).length,7,'One create and six immutable polls, no re-created list');
 const ended=await seed(2021);await record(ended,'create',metadata(ended,'idle',0));await pg.exec('alter table icash_research_private.owner_export_preflights disable trigger owner_preflight_immutable');
 await q("update icash_research_private.owner_export_preflights set created_at=now()-interval '30 minutes' where id=$1",[ended.id]);await pg.exec('alter table icash_research_private.owner_export_preflights enable trigger owner_preflight_immutable');
 assert.equal((await claim(ended)).status,'held');assert.ok(await v('select icash_claim_owner_preflight_cleanup($1)',[ended.id]),'Original lifetime expires without refresh');
 // Real transport: one canonical metadata GET, exact list-scoped free counts,
 // and cleanup after positive completion. No create/export/download retry.
 const service=await seed(2030);await record(service,'create',metadata(service,'idle',0));await due(service);
 const calls=[],key=process.env.DEALMACHINE_API_KEY;process.env.DEALMACHINE_API_KEY='fixture-only';
 const db=async(path,_method,p)=>{
  if(path==='rpc/icash_claim_owner_preflight')return claim(service);
  if(path==='rpc/icash_take_dealmachine_request'||path==='rpc/icash_finish_dealmachine_request')return true;
  if(path==='rpc/icash_record_owner_preflight')return v('select icash_record_owner_preflight($1,$2,$3,$4)',[p.p_id,p.p_lease,p.p_step,p.p_receipt]);
  if(path==='rpc/icash_claim_owner_preflight_cleanup')return v('select icash_claim_owner_preflight_cleanup($1)',[p.p_id]);
  if(path==='rpc/icash_record_owner_preflight_cleanup')return v('select icash_record_owner_preflight_cleanup($1,$2,$3)',[p.p_id,p.p_token,p.p_receipt]);
  throw Error(path);
 };
 try{assert.equal((await preflightOwnerExport(db,service.account,service.items,service.request,async(url,o)=>{
  calls.push({url,method:o.method,body:o.body});
  if(o.method==='GET'){assert.equal(url,'https://api.v2.dealmachine.com/v1/lists/list-'+service.id);assert.equal(o.body,undefined);return Response.json(metadata(service).raw);}
  if(o.method==='DELETE')return Response.json({data:{deleted:true}});
  assert.equal(url,'https://api.v2.dealmachine.com/v1/people/search/count');assert.deepEqual(JSON.parse(o.body).include_lists,{people_list_ids:['list-'+service.id]});return Response.json(count(1).raw);
 })).status,'ready');assert.deepEqual(calls.map(x=>x.method),['GET','POST','POST','DELETE']);}
 finally{if(key===undefined)delete process.env.DEALMACHINE_API_KEY;else process.env.DEALMACHINE_API_KEY=key;}
 // A durable original wait must yield before the existing bounded five-account
 // scan. Real retry admission is used; no synthetic "work completed" is added.
 await pg.exec('update icash_discovery_configs set enabled=false');
 const delayed=await seed(2040);await record(delayed,'create',metadata(delayed,'idle',0));
 await q(`insert into icash_automation_tickets(id,token,account_id,kind,screening_id,state,created_at,expires_at)
 values($1,'synthetic-indexing-token',$2,'contacts',$3,'consumed',now(),now()+interval '2 minutes')`,[delayed.ticket,delayed.account,delayed.screening]);
 assert.equal(await v('select icash_defer_owner_preflight($1,$2,$3,$4,$5)',[delayed.ticket,delayed.account,delayed.screening,'synthetic-indexing-token','owners:'+delayed.account+':'+delayed.screening]),true);
 const ticket=await v('select to_jsonb(t) from icash_automation_tickets t where id=$1',[delayed.ticket]);
 assert.equal(ticket.owner_preview_deferrals,1);assert.ok(Date.parse(ticket.owner_preview_retry_after)>=Date.parse((await row(delayed)).next_check_at));
 for(let n=3000;n<3129;n++)await v("select fixture_preflight_seed($1,true,interval '6 minutes')",[n]);
 await pg.exec(`update icash_automation_tickets set owner_preview_retry_after=greatest(owner_preview_retry_after,now()+interval '90 seconds') where state='held';
 update icash_research_private.owner_export_preflights set next_check_at=now()+interval '90 seconds' where state='waiting';
 update icash_screening_jobs set result='{"financialCheck":{"status":"ineligible"}}' where event_key like 'synthetic-fresh-%';`);
 const aged=await v("select fixture_preflight_seed(9000,false,interval '11 minutes')");
 assert.ok(await v('select icash_next_acquisition()'));assert.equal(await v("select account_id from icash_automation_tickets where state='issued'"),aged.account,'An eligible aged account advances past 130 waiting lists');
 for(let i=0;i<28;i++){
  const reads=await v('select count(*)::integer from fixture_priority_reads');assert.equal(await v('select icash_next_acquisition()'),null);
  assert.ok(await v('select count(*)::integer from fixture_priority_reads')-reads<=5,'Each scan remains bounded to five accounts');
 }
 assert.equal(await v("select count(*)::integer from icash_automation_tickets where state='issued'"),1,'Waiting rows never consume repeated capabilities');
 const other=await v("select fixture_preflight_seed(9001,false,interval '2 minutes')");assert.ok(await v('select icash_next_acquisition()'));
 assert.equal(await v("select count(distinct account_id)::integer from icash_automation_tickets where state='issued'"),2,'Independent eligible accounts both advance');
 await q('update icash_discovery_configs set next_run_at=now() where account_id=$1',[delayed.account]);await due(delayed);
 await q('update icash_automation_tickets set owner_preview_retry_after=now() where id=$1',[delayed.ticket]);
 assert.ok(await v('select icash_next_acquisition()'));assert.equal(await v('select state from icash_automation_tickets where id=$1',[delayed.ticket]),'issued');
 assert.equal(await v('select owner_preview_deferrals from icash_automation_tickets where id=$1',[delayed.ticket]),1,'Reissue does not reset the bounded retry budget');
 assert.equal(await v('select icash_next_acquisition()'),null,'Only one capability for the original waiting account');
 assert.equal(await v('select count(*)::int from icash_operation_spend'),0);assert.equal(await v('select count(*)::int from icash_credit_reservations'),0);assert.equal(await v('select count(*)::int from fixture_ready_admissions'),0);
 for(const role of ['anon','authenticated','service_role'])for(const signature of ['icash_research_private.owner_preflight_list_known(uuid,boolean)','icash_research_private.record_owner_preflight_indexing(uuid,uuid,text,jsonb)'])assert.equal(await v('select has_function_privilege($1,$2,\'execute\')',[role,signature]),false);
 console.log('PASS original list indexing: live idle/zero failures reproduced; bounded original metadata/counts; immutable receipts; Pause/identity/cost/lifetime gates; 130-list backlog yields to distinct accounts with five-account scans and one-use retry; no paid work.');
}finally{await pg.close();}
