import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {createRequire} from 'node:module';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const native=process.env.ICASH_CREDIT_NATIVE_TEST==='1';
let Client;
const connection={host:'127.0.0.1',port:55451,user:'postgres',password:'isolated-fixture-only',database:'icash_reliability',ssl:false,connectionTimeoutMillis:5000};
let db;
if(native){
 Client=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE??'pg').Client;
 const client=new Client(connection);await client.connect();
 // Docker may report its internal address/port. The actual client socket
 // must still reach only our fixed loopback fixture mapping.
 const socket=client.connection?.stream;
 assert.deepEqual({host:socket?.remoteAddress,port:socket?.remotePort},{host:'127.0.0.1',port:55451});
 const proof=(await client.query("select current_database() db,current_user username,current_setting('server_version_num')::integer version")).rows[0];
 assert.equal(proof.db,'icash_reliability');assert.equal(proof.username,'postgres');assert(proof.version>=170000&&proof.version<180000);
 db={query:(s,args=[])=>client.query(s,args.map(x=>Array.isArray(x)?JSON.stringify(x):x)),exec:s=>client.query(s),close:()=>client.end()};
}else db=new PGlite();
const q=(s,a=[])=>db.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const rpc=(name,...args)=>v('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+')',args);
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const account=id(2),batch=id(1),release='a'.repeat(40);
const wrap=(httpStatus,raw)=>({httpStatus,raw,rawText:JSON.stringify(raw)});
const refusal=()=>{const details={remaining_credits:0,monthly_enrichment_credit_cap:100000,additional_enrichment_credit_balance:0,monthly_remaining:0,additional_remaining:0,total_enrichment_credit_cap:100000,total_enrichment_credit_available:0,billing_cycle_end:'2099-11-30T15:30:25.000Z'};return wrap(402,{error:{code:'export_limit_exceeded',message:'Data credit limit reached for this billing cycle.',request_id:'req_fixture',details},usage:{credits_used:109339,credits_remaining:0,...Object.fromEntries(Object.entries(details).filter(([k])=>k!=='remaining_credits'))}});};
async function request(n,kind='owner_lookup',status=402){await q("insert into icash_research_private.requests values($1,$2,$3,$4,true,clock_timestamp()-interval '2 seconds',clock_timestamp()-interval '1 second',$5)",[id(n),kind,account,kind==='owner_lookup'?'owner-batch:'+id(n):'fixture:'+n,{outcome:status===200?'response':'http_error',httpStatus:status}]);}
async function due(){await q("update icash_research_private.dealmachine_credit_state set next_check_at=clock_timestamp()-interval '1 second'");}
async function usage(claim,available=0){await q("update icash_research_private.requests set finished_at=clock_timestamp(),result='{"+'"outcome":"response","httpStatus":200'+"}' where id=$1",[claim.requestId]);const receipt=wrap(200,{plan:{name:'fixture',is_paid:true},billing_cycle:{start:'2020-01-01T00:00:00Z',end:'2099-11-30T15:30:25Z'},credits:{total_cap:100000,total_available:available,used:109339}});receipt.headers={date:new Date(await v('select clock_timestamp()')).toUTCString(),age:null};return receipt;}
async function scenario(run){await db.exec('begin');try{await run();}finally{await db.exec('rollback');}}
async function inventoryProof({stale=false,active=false}={}){
 const review=await rpc('icash_claim_automatic_export_capacity',release);assert(review?.reviewId,'Exact credit source admits an automatic capacity review');
 for(const probe of ['inventory','pending','processing']){
  if(probe!=='inventory')assert(await rpc('icash_claim_export_capacity_probe',review.reviewId,probe));
  const data=probe==='inventory'?[{export_id:'prior_export',status:'completed',created_at:'2020-01-01T00:00:00Z'}]:active&&probe==='processing'?[{export_id:'active_export',status:'processing'}]:[];
  const receipt=wrap(200,{data,pagination:{limit:100,offset:0,total:data.length,has_more:false}});
  receipt.headers={minuteRemaining:50,dayRemaining:900,date:stale?'Mon, 01 Jan 2001 00:00:00 GMT':new Date(await v('select clock_timestamp()')).toUTCString(),age:null};
  assert.equal(await rpc('icash_record_export_capacity_probe',review.reviewId,probe,receipt),true);
 }
 return {review,result:await rpc('icash_finish_automatic_export_capacity',review.reviewId)};
}
try{
 for(const path of ['tests/fixtures/automatic-export-foundation.sql','config/owner-export-capacity-recovery.sql','supabase/migrations/20261030012215_owner_export_capacity_precision.sql','config/automatic-export-capacity.sql','config/gateway-export-capacity.sql','config/empty-export-capacity.sql','config/empty-export-immediate-capacity.sql','tests/fixtures/unknown-export-foundation.sql','tests/fixtures/unknown-export-late-foundation.sql','tests/fixtures/unknown-export-late-live-functions.sql','tests/fixtures/unknown-export-late-batch-function.sql','config/unknown-export-capacity.sql','config/unknown-export-late-evidence.sql','config/ended-export-status-recovery.sql'])await db.exec(read(path));
 await db.exec(`create table public.icash_dealmachine_request_budget(id integer primary key,minute_start timestamptz,minute_used integer,minute_limit integer,day_start timestamptz,day_used integer,day_limit integer);
 insert into public.icash_dealmachine_request_budget values(1,clock_timestamp(),0,70,clock_timestamp(),0,10000);
 create table icash_research_private.request_reserve_admissions(request_id uuid,account_id uuid,day_start timestamptz,first_funded_at timestamptz,created_at timestamptz);
 create table icash_research_private.maintenance_request_admissions(request_id uuid,token uuid,list_id text,protected boolean,day_start timestamptz,created_at timestamptz);
 create function icash_research_private.request_reserve_state(timestamptz) returns jsonb language sql as $$select '{"ordinaryRemaining":65,"reserveRemaining":0,"maintenanceRemaining":0}'::jsonb$$;
 create function icash_research_private.starter_export_dependency_current(uuid) returns boolean language sql as $$select false$$;
 create function public.icash_dealmachine_provider_available() returns boolean language sql as $$select true$$;
 create function icash_research_private.maintenance_exclusion_allowed(text,timestamptz) returns boolean language sql as $$select false$$;
 create function icash_research_private.starter_exclusion_request_allowed(uuid,text,timestamptz) returns boolean language sql as $$select false$$;
 create function icash_research_private.starter_request_allowance(uuid,timestamptz) returns integer language sql as $$select 0$$;
 create table icash_research_private.owner_export_quota_policy(id integer primary key,enabled boolean,release_sha text,activated_at timestamptz,function_hashes jsonb);
 insert into icash_research_private.owner_export_quota_policy values(1,true,repeat('b',40),now()-interval '1 day','{}');`);
 const before=[...JSON.parse(read('tests/fixtures/provider-credit-wait-before.json')),...JSON.parse(read('tests/fixtures/provider-credit-wait-additional-before.json'))];
 for(const f of before){await db.exec(f.definition);await db.exec('revoke all on function '+f.signature+' from public,anon,authenticated,service_role');if(f.proacl.includes('service_role=X/postgres'))await db.exec('grant execute on function '+f.signature+' to service_role');}
 await db.exec(`create or replace function public.icash_take_dealmachine_request(text,uuid,text,uuid) returns boolean language sql as $$select icash_research_private.take_reserved_request($1,$2,$3,$4)$$;
 update icash_research_private.owner_export_quota_policy set function_hashes=jsonb_build_object('icash_research_private.take_reserved_request(text,uuid,text,uuid)',md5(pg_get_functiondef('icash_research_private.take_reserved_request(text,uuid,text,uuid)'::regprocedure)),'public.icash_prune_research_requests()',md5(pg_get_functiondef('public.icash_prune_research_requests()'::regprocedure)),'public.icash_finish_dealmachine_request(uuid,jsonb)',md5(pg_get_functiondef('public.icash_finish_dealmachine_request(uuid,jsonb)'::regprocedure)));`);
 await request(1);const original=refusal();
 await q('insert into icash_research_private.owner_batches(id,account_id,paid_receipt) values($1,$2,$3)',[batch,account,original.raw]);
 await q('insert into icash_research_private.owner_exports(id,request,receipt) values($1,$2,$3)',[batch,{people_ids:['per_123'],limit:1,anchor:'person',fields:['person_full_name','has_active_phone_number','phone_1_usage_2_months_id','phone_1_usage_12_months_id','phone_2_usage_2_months_id','phone_2_usage_12_months_id','phone_3_usage_2_months_id','phone_3_usage_12_months_id'],scrub_dnc:true,require_phone:true,property_match:'owner',active_phones_only:true},original]);
 await db.exec("insert into public.icash_operation_spend values('original','dispatched',105)");
 const money=await v('select to_jsonb(s) from public.icash_operation_spend s');
 const exportBefore=await v('select to_jsonb(e) from icash_research_private.owner_exports e');
 const policyBefore=await v('select to_jsonb(p) from icash_research_private.owner_export_quota_policy p');
 await db.exec(read('config/provider-credit-wait.sql'));
 assert.equal((await rpc('icash_dealmachine_credit_status')).status,'credit_check_not_requested');
 assert.equal(await rpc('icash_claim_dealmachine_credit_check',release),null);
 assert.equal(await v('select blocked from icash_research_private.dealmachine_credit_state'),true,'Exact active original seeded without replay');
 const policyAfter=await v('select to_jsonb(p) from icash_research_private.owner_export_quota_policy p');
 assert.deepEqual({...policyAfter,function_hashes:null},{...policyBefore,function_hashes:null});
 assert.deepEqual(Object.keys(policyAfter.function_hashes).sort(),Object.keys(policyBefore.function_hashes).sort());
 assert.equal(policyAfter.function_hashes['public.icash_finish_dealmachine_request(uuid,jsonb)'],policyBefore.function_hashes['public.icash_finish_dealmachine_request(uuid,jsonb)']);
 assert.equal(await v('select icash_research_private.activate_dealmachine_credit_wait($1)',[release]),true);
 const count=await v('select minute_used from public.icash_dealmachine_request_budget');
 for(const [n,kind] of [[10,'owner_lookup'],[11,'property_search'],[12,'buyer_search'],[13,'property_lookup']])assert.equal(await rpc('icash_take_dealmachine_request',kind,account,'fixture',id(n)),false);
 assert.equal(await v('select minute_used from public.icash_dealmachine_request_budget'),count);
 assert.equal(await v("select count(*)::integer from icash_research_private.requests where result->>'outcome'='provider_credit_exhausted'"),4);
 assert.equal(await rpc('icash_take_dealmachine_request','search_estimate',account,'free-fixture',id(14)),true);
 assert.equal(await rpc('icash_take_dealmachine_request','owner_preview',account,'owner-export-recovery:'+batch,id(15)),true,'Original-ID free recovery remains available while credits are exhausted');
 await scenario(async()=>{
  await q('update public.icash_dealmachine_request_budget set minute_used=minute_limit');
  assert.equal(await rpc('icash_take_dealmachine_request','owner_preview',account,'owner-export-recovery:'+batch,id(16)),false);
  assert.deepEqual(await v('select result from icash_research_private.requests where id=$1',[id(16)]),{outcome:'quota_wait'},'Free quota recovery keeps its exact existing denial contract');
 });
 await scenario(async()=>{
  // Use the existing admission wrapper unchanged; only its large unrelated
  // account/financial fixture dependencies are replaced by the real paid gate.
  const wrapper=read('config/owner-batch-quota-admission.sql').match(/create function public\.icash_admit_owner_batch[\s\S]*?end \$\$;/)?.[0];assert(wrapper);
  await db.exec(wrapper.replace('create function','create or replace function'));
  await db.exec(`create or replace function public.icash_claim_owner_batch(p_account uuid,p_primary uuid,p_batch uuid,p_items jsonb,p_preview jsonb,p_config jsonb) returns boolean language plpgsql as $$begin
   return public.icash_take_dealmachine_request('owner_lookup',p_account,'owner-batch:'||p_batch,p_batch);end$$;`);
  assert.equal(await rpc('icash_admit_owner_batch',account,id(17),id(18),[],{},{}),'quota_wait');
  assert.equal(await v('select count(*)::integer from icash_research_private.owner_batches where id=$1',[id(18)]),0);
  assert.deepEqual(await v('select to_jsonb(s) from public.icash_operation_spend s'),money);
 });
 let claim=await rpc('icash_claim_dealmachine_credit_check',release);assert(claim?.checkId&&claim?.requestId);
 assert.equal(await rpc('icash_claim_dealmachine_credit_check',release),null,'At most one claim per interval');
 let receipt=await usage(claim,0);
 assert.equal(await rpc('icash_record_dealmachine_credit_check',claim.checkId,receipt),'provider_credit_exhausted');
 assert.equal(await rpc('icash_record_dealmachine_credit_check',claim.checkId,receipt),'provider_credit_exhausted');
 assert.equal(await rpc('icash_record_dealmachine_credit_check',claim.checkId,{...receipt,rawText:'{}'}),'credit_check_held');
 await due();claim=await rpc('icash_claim_dealmachine_credit_check',release);receipt=await usage(claim,55);
 await request(20,'property_search');assert.equal(await rpc('icash_record_dealmachine_credit_refusal',id(20),refusal()),'provider_credit_exhausted');
 assert.equal(await rpc('icash_record_dealmachine_credit_check',claim.checkId,receipt),'credit_check_held','A newer refusal wins over in-flight positive usage');
 assert.equal((await rpc('icash_dealmachine_credit_status')).status,'provider_credit_exhausted');
 await due();claim=await rpc('icash_claim_dealmachine_credit_check',release);receipt=await usage(claim,55);
 assert.equal(await rpc('icash_record_dealmachine_credit_check',claim.checkId,receipt),'provider_credit_available');
 assert.equal(await rpc('icash_take_dealmachine_request','property_search',account,'resumed',id(21)),true);
 await q("update icash_research_private.export_capacity_automation set enabled=true");
 assert.equal(await v('select icash_research_private.capacity_source_policy($1,md5($2::jsonb::text))',[batch,original]),'credit-idle-v1');
 assert.deepEqual(await v('select to_jsonb(e) from icash_research_private.owner_exports e'),exportBefore,'Balance alone does not release or mutate the original export');
 assert.deepEqual(await v('select to_jsonb(s) from public.icash_operation_spend s'),money);
 // Positive balance never substitutes for the three existing free inventory
 // reads, provider freshness, a terminal nonempty history, or an empty queue.
 await scenario(async()=>{assert.equal((await inventoryProof({stale:true})).result,'capacity_review_held');assert.equal(await rpc('icash_owner_active_export_capacity'),'export_busy');});
 await scenario(async()=>{assert.equal((await inventoryProof({active:true})).result,'capacity_review_held');});
 await scenario(async()=>{
  await q('insert into icash_research_private.owner_export_capacity_reviews(export_id,receipt_hash,reviewed_release) values($1,md5($2::jsonb::text),$3)',[batch,original,release]);
  assert.equal(await rpc('icash_claim_automatic_export_capacity',release),null,'An explicit manual review retains its authority');
 });
 await scenario(async()=>{
  const {review,result}=await inventoryProof();assert.equal(result,'capacity_verified');
  const after=await v('select to_jsonb(e) from icash_research_private.owner_exports e');
  assert.deepEqual({...after,capacity_review_id:null},exportBefore);assert.equal(after.capacity_review_id,review.reviewId);
  assert.equal(await rpc('icash_owner_active_export_capacity'),'ready');
  assert.equal(await rpc('icash_owner_export_people_available',['per_123']),false,'Original owners remain reserved after capacity-only release');
  assert.deepEqual(await v('select to_jsonb(s) from public.icash_operation_spend s'),money);
 });
 // A delayed capacity review remains recoverable: stale positive usage can be
 // refreshed on the same cadence while the exact original still blocks.
 await due();claim=await rpc('icash_claim_dealmachine_credit_check',release);assert(claim?.checkId);
 receipt=await usage(claim,55);assert.equal(await rpc('icash_record_dealmachine_credit_check',claim.checkId,receipt),'provider_credit_available');
 for(const [name,mutate] of [
  ['cached',async(r)=>{r.headers.age='1';}],['missing Date',async(r)=>{delete r.headers.date;}],
  ['old Date',async(r)=>{r.headers.date='Mon, 01 Jan 2001 00:00:00 GMT';}],
  ['unpaid plan',async(r)=>{r.raw.plan.is_paid=false;r.rawText=JSON.stringify(r.raw);}],
  ['negative credits',async(r)=>{r.raw.credits.total_available=-1;r.rawText=JSON.stringify(r.raw);}],
  ['conflicting remaining',async(r)=>{r.raw.credits.remaining=0;r.rawText=JSON.stringify(r.raw);}],
  ['raw mismatch',async(r)=>{r.rawText='{}';}],
  ['cumulative interpreted as charge',async(_r,c)=>{await q("update icash_research_private.requests set result=result||'{\"creditsUsed\":109339}'::jsonb where id=$1",[c.requestId]);}],
  ['unfinished request',async(_r,c)=>{await q('update icash_research_private.requests set finished_at=null,result=null where id=$1',[c.requestId]);}],
  ['wrong account',async(_r,c)=>{await q('update icash_research_private.requests set account_id=$2 where id=$1',[c.requestId,account]);}],
  ['wrong operation',async(_r,c)=>{await q("update icash_research_private.requests set operation_key='other' where id=$1",[c.requestId]);}]
 ])await scenario(async()=>{
  await request(30,'property_search');assert.equal(await rpc('icash_record_dealmachine_credit_refusal',id(30),refusal()),'provider_credit_exhausted');
  await due();const c=await rpc('icash_claim_dealmachine_credit_check',release),r=await usage(c,55);await mutate(r,c);
  assert.equal(await rpc('icash_record_dealmachine_credit_check',c.checkId,r),'credit_check_held',name);
  assert.deepEqual(await v('select receipt from icash_research_private.dealmachine_credit_checks where id=$1',[c.checkId]),r,'First bounded evidence survives failed validation: '+name);
  assert.equal((await rpc('icash_dealmachine_credit_status')).status,'provider_credit_exhausted');
  assert.equal(await rpc('icash_claim_dealmachine_credit_check',release),null);
 });
 // New common transport captures quota headers before the original writer.
 // The immutable common fields still bind that future path to the same export.
 await scenario(async()=>{
  assert.equal((await inventoryProof()).result,'capacity_verified');
  await request(40);await q('insert into icash_research_private.owner_batches(id,account_id) values($1,$2)',[id(40),account]);
  await q('insert into icash_research_private.owner_exports(id,request) values($1,$2)',[id(40),{...exportBefore.request,people_ids:['per_456']}]);
  const captured={...original,headers:{minuteRemaining:62,dayRemaining:4006,date:null,age:null}};
  assert.equal(await rpc('icash_record_dealmachine_credit_refusal',id(40),captured),'provider_credit_exhausted');
  assert.equal(await rpc('icash_record_owner_export_receipt',account,id(40),original),true);
  await due();const c=await rpc('icash_claim_dealmachine_credit_check',release),r=await usage(c,55);
  assert.equal(await rpc('icash_record_dealmachine_credit_check',c.checkId,r),'provider_credit_available');
  assert.equal((await inventoryProof()).result,'capacity_verified');
 });
 await scenario(async()=>{await q("update icash_research_private.owner_batches set account_id=$2 where id=$1",[batch,id(99)]);assert.equal(await v('select icash_research_private.credit_export_source($1,md5($2::jsonb::text))',[batch,original]),false);});
 await scenario(async()=>{await q("update icash_research_private.owner_exports set request=jsonb_set(request,'{active_phones_only}','false') where id=$1",[batch]);assert.equal(await v('select icash_research_private.credit_export_source($1,md5($2::jsonb::text))',[batch,original]),false);});
 for(const mutate of [r=>{r.raw.error.code='other';},r=>{r.raw.usage.credits_remaining=1;},r=>{r.raw.error.details.remaining_credits=1;},r=>{r.raw.extra='unexpected';}])await scenario(async()=>{await request(31,'buyer_search');const r=refusal();mutate(r);r.rawText=JSON.stringify(r.raw);assert.equal(await rpc('icash_record_dealmachine_credit_refusal',id(31),r),'credit_check_held');});
 for(const role of ['anon','authenticated','service_role'])assert.equal(await v("select has_table_privilege($1,'icash_research_private.dealmachine_credit_state','select')",[role]),false);
 for(const table of ['dealmachine_credit_state','dealmachine_credit_refusals','dealmachine_credit_checks'])assert.equal(await v("select relrowsecurity from pg_class where oid=$1::regclass",['icash_research_private.'+table]),true);
 for(const role of ['anon','authenticated'])for(const fn of ['public.icash_claim_dealmachine_credit_check(text)','public.icash_record_dealmachine_credit_check(uuid,jsonb)','public.icash_record_dealmachine_credit_refusal(uuid,jsonb)','public.icash_dealmachine_credit_status()'])assert.equal(await v("select has_function_privilege($1,$2,'execute')",[role,fn]),false);
 assert.equal(await v("select has_function_privilege('service_role','icash_research_private.activate_dealmachine_credit_wait(text)','execute')"),false);
 await assert.rejects(()=>q('delete from icash_research_private.dealmachine_credit_refusals where request_id=$1',[batch]),/immutable/);
 await assert.rejects(()=>q("update icash_research_private.dealmachine_credit_checks set receipt='{}' where id=$1",[claim.checkId]),/immutable/);
 await scenario(async()=>{
  await db.exec('create or replace function icash_research_private.credit_count(p jsonb) returns boolean language sql immutable as $$select false$$');
  assert.equal(await v('select icash_research_private.activate_dealmachine_credit_wait($1)',[release]),false,'Activation rejects source drift');
 });
 // The normal retention job keeps binding evidence beyond 30 days while still
 // pruning an unrelated old request. No historical receipt is cleared.
 await db.exec('create table if not exists icash_research_private.estimates(operation_key text,updated_at timestamptz,lease_until timestamptz)');
 for(const table of ['owner_preflight_quota_deferrals','preview_rejection_recoveries','stalled_searches','owner_empty_preview_receipts','owner_export_quota_requests'])await db.exec('create table if not exists icash_research_private.'+table+'(request_id uuid)');
 await request(83,'property_lookup');
 await q("update icash_research_private.requests set created_at=now()-interval '40 days',finished_at=now()-interval '39 days' where id=$1",[id(83)]);
 assert.equal(await rpc('icash_record_dealmachine_credit_refusal',id(83),refusal()),'provider_credit_exhausted');
 await q("insert into icash_research_private.requests(id,kind,created_at) values($1,'search_estimate',now()-interval '40 days')",[id(84)]);
 assert.equal(await rpc('icash_prune_research_requests'),1);
 assert.equal(await v('select count(*)::integer from icash_research_private.requests where id=$1',[id(83)]),1);
 await scenario(async()=>{
  await due();const c=await rpc('icash_claim_dealmachine_credit_check',release);assert.equal(await rpc('icash_record_dealmachine_credit_check',c.checkId,await usage(c,55)),'provider_credit_available');
  await db.exec("insert into icash_research_private.owner_exports(id,terminal_at,receipt) select gen_random_uuid(),now(),'{\"history\":true}'::jsonb from generate_series(1,5000);analyze icash_research_private.owner_exports");
  const plan=await q('explain (format json) select id from icash_research_private.owner_exports where terminal_at is null and capacity_review_id is null');
  assert(JSON.stringify(plan.rows).includes('owner_export_one_pending'),'Pending-only refresh uses the bounded pending-export index');
  await due();assert((await rpc('icash_claim_dealmachine_credit_check',release))?.checkId);
 });
 if(native){
  const clients=await Promise.all(Array.from({length:16},async()=>{const c=new Client(connection);await c.connect();return c;}));
  try{
   await request(80,'property_search');await rpc('icash_record_dealmachine_credit_refusal',id(80),refusal());await due();
   const admitted=(await Promise.all(clients.map(c=>c.query('select public.icash_claim_dealmachine_credit_check($1) claim',[release])))).map(x=>x.rows[0].claim).filter(Boolean);
   assert.equal(admitted.length,1,'Parallel maintenance admits exactly one free GET');
   await clients[2].query('begin');await clients[2].query('select 1 from public.icash_dealmachine_request_budget where id=1 for update');
   try{
    assert.equal(await rpc('icash_claim_dealmachine_credit_check',release),null,'Not-due maintenance bypasses a held request budget');
    await due();assert.equal(await rpc('icash_claim_dealmachine_credit_check',release),null,'Due maintenance skips a contended budget without blocking');
   }finally{await clients[2].query('rollback');}
   const before=await v('select minute_used from public.icash_dealmachine_request_budget');
   const paid=await Promise.all(clients.map((c,i)=>c.query("select public.icash_take_dealmachine_request('property_search',$1,'parallel',$2) ok",[account,id(100+i)])));
   assert(paid.every(x=>x.rows[0].ok===false));assert.equal(await v('select minute_used from public.icash_dealmachine_request_budget'),before);
   const r=await usage(admitted[0],55);await request(81,'buyer_search');
   await Promise.all([clients[0].query('select public.icash_record_dealmachine_credit_check($1,$2)',[admitted[0].checkId,r]),clients[1].query('select public.icash_record_dealmachine_credit_refusal($1,$2)',[id(81),refusal()])]);
   assert.equal((await rpc('icash_dealmachine_credit_status')).status,'provider_credit_exhausted','Refusal wins either serialization order');
   console.log('PASS native credit concurrency: 16 simultaneous claims, 16 blocked paid admissions, and positive-usage/new-refusal race.');
  }finally{await Promise.all(clients.map(c=>c.end()));}
 }
 console.log('PASS provider credit SQL: exact original seed; disabled install; immutable evidence; four paid gates; free admission; bounded checks; newer-refusal protection; refill resumption; source policy; money/original and active manifest preservation.');
}finally{await db.close();}
