import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=new PGlite(),q=(s,a=[])=>pg.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
let next=1;
const seed=(n=0)=>v('select fixture_preview_rejection_seed($1,$2)',[next++,n]);
const args=c=>[c.ticket,c.request,c.ticketHash,c.requestHash,c.screeningHash,c.configHash,c.rateHash,c.release,c.trace];
const repair=c=>v('select public.icash_recover_rejected_owner_preview($1,$2,$3,$4,$5,$6,$7,$8,$9)',args(c));
const ticket=c=>v('select to_jsonb(t) from icash_automation_tickets t where id=$1',[c.ticket]);
const request=c=>v('select to_jsonb(r) from icash_research_private.requests r where id=$1',[c.request]);
const refresh=async c=>{c.ticketHash=await v("select encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') from icash_automation_tickets t where id=$1",[c.ticket]);c.requestHash=await v('select md5(to_jsonb(r)::text) from icash_research_private.requests r where id=$1',[c.request]);return c;};
const isolated=async fn=>{await pg.exec('begin');try{await fn();}finally{await pg.exec('rollback');}};
try{
 await pg.exec("set timezone='UTC'");
 await pg.exec(read('tests/fixtures/opportunity-schema.sql'));
 await pg.exec(read('tests/fixtures/owner-preview-rejection-recovery.sql'));
 const def=read('config/owner-enrichment-deferral.sql');
 await pg.exec(def.slice(0,def.indexOf('create function public.icash_defer_owner_enrichment'))+'\ncommit;');
 await pg.exec(read('config/owner-enrichment-evidence-indexes.sql'));
 const finish=def.indexOf('create function public.icash_finish_owner_enrichment');
 await pg.exec(def.slice(finish,def.indexOf('-- Older deployed workers',finish)));
 const guards=def.indexOf('create function public.icash_guard_owner_enrichment_recovery_credit');
 await pg.exec(def.slice(guards,def.indexOf('-- Keep the complete authoritative candidate',guards)));
 await pg.exec(read('config/owner-preview-empty.sql'));await pg.exec(read('config/owner-preview-empty-credit-shape.sql'));
 const sql=read('config/owner-preview-rejection-recovery.sql');
 assert.equal(sql,read('supabase/migrations/20261103054854_owner_preview_rejection_recovery.sql'));await pg.exec(sql);
 const first=await seed();assert.equal(await repair(first),false,'Deployment has neither enabled recovery nor enrolled policy');
 await pg.exec("insert into icash_research_private.preview_rejection_policy values(1,repeat('a',40),'dpl_SyntheticFixture123',clock_timestamp()-interval '12 minutes',clock_timestamp()-interval '6 minutes','27af55c3f732c75a9edddc287bfd8d29')");
 assert.equal(await repair(first),false,'Reviewed policy alone does not enable continuation');
 await pg.exec('update icash_research_private.owner_export_settings set preview_rejection_recovery_enabled=true');
 const before=await ticket(first),originalRequest=await request(first);
 await pg.exec("set timezone='Pacific/Honolulu';set role service_role");
 try{assert.equal(await repair(first),true,'Exact reviewed local handler can continue through existing bounded family from another timezone');}
 finally{await pg.exec("reset role;set timezone='UTC'");}
 const after=await ticket(first);
 for(const field of ['id','token','account_id','screening_id','state','created_at','completed_at','expires_at','issue_attempts'])assert.deepEqual(after[field],before[field],field+' remains original until ordinary issuance');
 assert.equal(after.outcome,'owner_preview_rate_limited');assert.equal(after.owner_preview_deferrals,1);
 assert.equal(after.owner_preview_screening_hash,first.screeningHash);
 assert.deepEqual(await request(first),originalRequest,'Original provider metrics never change');
 const saved=await v('select to_jsonb(r) from icash_research_private.preview_rejection_recoveries r where ticket_id=$1',[first.ticket]);
 assert.deepEqual(saved.before_ticket,before);assert.deepEqual(saved.request,originalRequest);assert.deepEqual(saved.reviewed_trace,first.trace);
 assert.equal(saved.reviewed_trace.rawPreviewAvailable,false);
 assert.equal(await repair(first),false);assert.deepEqual(await ticket(first),after,'Approval replay cannot refresh timing, cap or capability');
 assert.equal(await v('select approved_max_charge_cents from icash_owner_enrichment_recoveries where ticket_id=$1',[first.ticket]),105);
 const continued=await seed(3),old=await ticket(continued);assert.equal(await repair(continued),true);
 const resumed=await ticket(continued);assert.equal(resumed.owner_preview_deferrals,3);assert.equal(resumed.owner_preview_retry_until,old.owner_preview_retry_until);assert.equal(resumed.owner_preview_screening_hash,old.owner_preview_screening_hash);
 for(const key of ['ticketHash','requestHash','screeningHash','configHash','rateHash','release']){
  const c=await seed();c[key]='b'.repeat(c[key].length);assert.equal(await repair(c),false,key+' must bind original reviewed evidence');
 }
 for(const mutate of [c=>{c.trace.ticketId=c.request;},c=>{c.trace.requestId=c.ticket;},c=>{c.trace.accountId=c.ticket;},c=>{c.trace.screeningId=c.ticket;},c=>{c.trace.batchId=c.ticket;},c=>{c.trace.deployment='dpl_AnotherDeployment';},c=>{c.trace.rawPreviewAvailable=true;},c=>{delete c.trace.recordedAt;},c=>{c.trace.responseBytes='5';},c=>{c.trace.httpStatus=500;},c=>{c.trace.evidenceKind='provider_phone_proof';}]){
  const c=await seed();mutate(c);assert.equal(await repair(c),false,'Cross-scope/missing/nonlocal trace cannot approve a new capability');
 }
 for(const scope of [null,'owner-batch:not-a-uuid','owner-preview:00000000-0000-4000-8000-000000000001']){
  const c=await seed();await q('update icash_research_private.requests set operation_key=$1 where id=$2',[scope,c.request]);await refresh(c);assert.equal(await repair(c),false,'Invalid scope fails even with a refreshed exact review hash');
 }
 for(const result of [{outcome:'response',httpStatus:200,creditsUsed:0},{outcome:'response',httpStatus:200,creditsUsed:0,returned:'5'},{outcome:'response',httpStatus:200,creditsUsed:1,returned:5},{outcome:'http_error',httpStatus:500,creditsUsed:0,returned:5}]){
  const c=await seed();await q('update icash_research_private.requests set result=$1 where id=$2',[result,c.request]);await refresh(c);assert.equal(await repair(c),false,'Saved request must independently prove a finished free response');
 }
 for(const mutation of ["update icash_research_private.requests set admitted=null where id=$1","update icash_research_private.requests set kind=null where id=$1","update icash_research_private.requests set created_at=null where id=$1","update icash_research_private.requests set finished_at=null where id=$1"]){
  const c=await seed();await q(mutation,[c.request]);await refresh(c);assert.equal(await repair(c),false,'Missing admission or request chronology is not affirmative free-request proof');
 }
 for(const mutation of [
  "update icash_automation_tickets set owner_preview_deferrals=8 where id=$1",
  "update icash_automation_tickets set owner_preview_retry_until=now()-interval '1 second' where id=$1",
  "update icash_automation_tickets set owner_preview_screening_hash=repeat('0',64) where id=$1",
  "update icash_automation_tickets set expires_at=now()+interval '1 minute' where id=$1",
  "update icash_automation_tickets set completed_at=now()-interval '1 minute' where id=$1",
 ]){
  const c=await seed(1);await q(mutation,[c.ticket]);await refresh(c);assert.equal(await repair(c),false,'Timing/exhaustion/source lineage cannot be renewed by a fresh hash');
 }
 for(const mutate of [
  c=>q('insert into icash_research_private.owner_batches values($1,$2,\'[]\')',[c.batch,c.account]),
  c=>q("insert into icash_research_private.owner_batch_items values(gen_random_uuid(),$1,'other sibling operation')",[c.batch]),
  c=>q('insert into icash_research_private.owner_exports values($1)',[c.batch]),
  c=>q("insert into icash_research_private.requests select $1,'owner_lookup',account_id,operation_key,true,created_at,finished_at,result from icash_research_private.requests where id=$2",[c.batch,c.request]),
  c=>q("insert into icash_research_private.owner_export_preflights select gen_random_uuid(),account_id,created_at from icash_research_private.requests where id=$1",[c.request]),
  c=>q("insert into icash_research_private.requests select gen_random_uuid(),'owner_preview',account_id,'unrelated',true,created_at,finished_at,result from icash_research_private.requests where id=$1",[c.request]),
  c=>q("insert into icash_automation_tickets(account_id,kind,state,created_at,completed_at,expires_at) select account_id,'discovery','complete',created_at,completed_at,expires_at from icash_automation_tickets where id=$1",[c.ticket]),
  c=>q("insert into icash_cost_observations(provider,event_key,source_ref,amount,units) values('other',$1,'unknown original receipt',null,'unknown')",['owners:'+c.account+':'+c.screening+':original']),
 ]){const c=await seed();await mutate(c);assert.equal(await repair(c),false,'Any exact original batch/handler/unknown-work evidence stays fenced');}
 for(const mutation of [
  "update icash_accounts set bot_paused=true where id=$1",
  "update icash_wallets set balance_cents=0 where account_id=$1",
  "insert into icash_billing_reviews(event_id,payment_id,reason,account_id) values(gen_random_uuid()::text,'synthetic','uncertain',$1)",
  "insert into icash_property_controls select account_id,snapshot->>'propertyId',true,now() from icash_screening_jobs where account_id=$1",
  "delete from icash_owner_review_private.changes where after_row->>'id'=(select contact_rate_id::text from icash_discovery_configs where account_id=$1)",
 ]){const c=await seed();await q(mutation,[c.account]);assert.equal(await repair(c),false,'Current authority/funds/rate lineage still govern');}
 await isolated(async()=>{const c=await seed();await pg.exec('update fixture_preview_policy set member=false');assert.equal(await repair(c),false);});
 await isolated(async()=>{const c=await seed();await q("update icash_screening_jobs set snapshot=jsonb_set(snapshot,'{fetchedAt}',to_jsonb((now()-interval '25 hours')::text)) where id=$1",[c.screening]);c.screeningHash=await v('select icash_owner_enrichment_screening_hash(s) from icash_screening_jobs s where id=$1',[c.screening]);assert.equal(await repair(c),false,'Expired source cannot be approved anew');});
 await assert.rejects(q('update icash_research_private.preview_rejection_recoveries set reviewed_trace=\'{}\''),/immutable/);
 await assert.rejects(q('delete from icash_research_private.preview_rejection_policy'),/immutable/);
 await assert.rejects(q("insert into icash_credit_reservations(account_id,operation_key,amount_cents,status) values($1,$2,106,'reserved')",[first.account,'owners:'+first.account+':'+first.screening]),/approval exceeded/);
 for(const role of ['anon','authenticated','service_role']){
  assert.equal(await v("select has_function_privilege($1,'public.icash_recover_rejected_owner_preview(uuid,uuid,text,text,text,text,text,text,jsonb)','execute')",[role]),role==='service_role');
  assert.equal(await v("select has_table_privilege($1,'icash_research_private.preview_rejection_recoveries','select')",[role]),false);
 }
 assert.equal(await v('select count(*)::integer from icash_research_private.owner_empty_preview_receipts'),0,'Recovery creates no retrospective empty evidence');
 assert.equal(await v('select count(*)::integer from icash_credit_reservations'),0,'Recovery reserves no funds');
 console.log('Reviewed local preview rejection: disabled enrollment, exact immutable local evidence, whole-batch no-purchase fences, current source/Pause/funding/rate guards, preserved retry bounds, cap, UTC and private ACLs pass. No providers.');
}finally{await pg.close();}
