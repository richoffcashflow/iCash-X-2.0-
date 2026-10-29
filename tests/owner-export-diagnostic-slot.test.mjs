// Isolated PostgreSQL fixtures only: no provider, private data, or live database.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const sql=readFileSync(new URL('../config/owner-export-diagnostic-slot.sql',import.meta.url),'utf8');
const db=new PGlite(),q=(s,a=[])=>db.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const provider='dealmachine_active_phone_export_verification_20261029_v4';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const now=Date.now(),at=new Date(now-1000).toISOString();
const approval={status:'approved',version:4,explicitOwnerApproval:true,maxCredits:1,maxPaidRequests:1,maxProviderRequests:4,customerWalletCharge:false,callsOrTexts:false,automaticRetry:false,allowAboveAppQuota:false,approvalId:id(1),accountId:id(2),screeningId:id(3),personId:'per_123',propertyId:'prop_456',reviewedCommit:'a'.repeat(40),requestHash:'b'.repeat(64),sourceOperation:'owners:fixture',sourceCreatedAt:at,approvedAt:at,expiresAt:new Date(now+600000).toISOString(),request:{people_ids:['per_123'],fields:['person_full_name','has_active_phone_number'],property_match:'owner',anchor:'person',limit:1,require_phone:true,scrub_dnc:true,active_phones_only:true}};
const state=a=>({...a,status:'started',runId:id(4),startedAt:at,requests:[],outreach:false});
const claim=(a=approval,s=state(a),p=provider)=>v('select public.icash_claim_owner_export_diagnostic($1,$2,$3)',[p,a,s]);
const isolated=async f=>{await db.exec('begin');try{await f();}finally{await db.exec('rollback');}};
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema icash_research_private;
 create table public.icash_integration_checks(provider text primary key,result jsonb,checked_at timestamptz);
 create table public.icash_owner_contacts(account_id uuid,screening_id uuid,operation_key text,created_at timestamptz,result jsonb);
 create table icash_research_private.owner_exports(id uuid primary key,terminal_at timestamptz,receipt jsonb);
 create table public.icash_operation_spend(id uuid primary key);
 create table public.icash_credit_reservations(id uuid primary key);
 `);
 await db.exec(sql);
 await q('insert into public.icash_integration_checks values($1,$2,null)',[provider,approval]);
 const old={status:'failed',version:3,raw:{httpStatus:500},runId:id(9)};
 await q('insert into public.icash_integration_checks values($1,$2,null)',['v3-consumed',old]);
 await q('insert into public.icash_owner_contacts values($1,$2,$3,$4,$5)',[approval.accountId,approval.screeningId,approval.sourceOperation,at,{propertyId:approval.propertyId,requestedPersonIds:[approval.personId]}]);
 for(const mutate of [a=>{a.maxCredits=2},a=>{a.maxPaidRequests=2},a=>{a.maxProviderRequests=5},a=>{a.callsOrTexts=true},a=>{delete a.automaticRetry},a=>{a.customerWalletCharge=true},a=>{a.allowAboveAppQuota=true},a=>{a.version=3},a=>{a.explicitOwnerApproval=false},a=>{a.accountId=id(77)},a=>{a.sourceOperation='other'},a=>{a.sourceCreatedAt='invalid'},a=>{a.reviewedCommit='bad'},a=>{a.requestHash='bad'},a=>{a.expiresAt=at},a=>{a.expiresAt=new Date(now+7200000).toISOString()},a=>{a.request.fields.push('phone')},a=>{a.request.people_ids.push('per_2')},a=>{a.request.limit=2},a=>{a.request.active_phones_only=false},a=>{a.request.extra=true}]){
  const a=structuredClone(approval);mutate(a);
  // Save the invalid value too: test validation, not just the CAS predicate.
  await isolated(async()=>{await q('update public.icash_integration_checks set result=$1 where provider=$2',[a,provider]);assert.equal(await claim(a),false);});
 }
 assert.equal(await claim(approval,state(approval),'v3-consumed'),false);
 assert.equal(await claim(approval,{...state(approval),customerWalletCharge:true}),false);
 assert.equal(await claim({...approval,unapprovedExtra:true}),false,'full original approval CAS');
 assert.equal(await v('select count(*) from icash_research_private.owner_export_diagnostic_slots'),0);
 // Production first: unknown/HTTP500 hold remains and approval is not consumed.
 await isolated(async()=>{
  const receipt={httpStatus:500,raw:{error:'unknown'}};
  await q('insert into icash_research_private.owner_exports values($1,null,$2)',[id(10),receipt]);
  assert.equal(await claim(),false);
  assert.deepEqual(await v('select result from public.icash_integration_checks where provider=$1',[provider]),approval);
  assert.deepEqual(await v('select receipt from icash_research_private.owner_exports'),receipt);
 });
 // Diagnostic first: no production insert or same/new run can enter afterward.
 await isolated(async()=>{
  assert.equal(await claim(),true);
  assert.equal(await claim(),false);
  assert.equal(await claim(approval,{...state(approval),runId:id(5)}),false);
  await db.exec('savepoint blocked');
  await assert.rejects(q('insert into icash_research_private.owner_exports values($1,null,null)',[id(10)]),/diagnostic export slot held/);
  await db.exec('rollback to blocked');
  assert.equal(await v('select count(*) from icash_research_private.owner_exports'),0);
  assert.equal(await v('select count(*) from icash_research_private.owner_export_diagnostic_slots'),1);
  await db.exec('savepoint immutable');
  await assert.rejects(db.exec('delete from icash_research_private.owner_export_diagnostic_slots'),/original outcome reconciliation/);
  await db.exec('rollback to immutable');
  assert.equal(await v('select count(*) from public.icash_operation_spend'),0);
  assert.equal(await v('select count(*) from public.icash_credit_reservations'),0);
 });
 // PGlite serializes sessions: CAS/one-use check, not multi-backend contention.
 const results=await Promise.all([claim(),claim()]);assert.deepEqual(results,[true,false]);
 assert.deepEqual(await v('select result from public.icash_integration_checks where provider=$1',['v3-consumed']),old);
 for(const role of ['anon','authenticated'])assert.equal(await v("select has_function_privilege($1,'public.icash_claim_owner_export_diagnostic(text,jsonb,jsonb)','EXECUTE')",[role]),false);
 assert.equal(await v("select has_function_privilege('service_role','public.icash_claim_owner_export_diagnostic(text,jsonb,jsonb)','EXECUTE')"),true);
 for(const role of ['anon','authenticated','service_role'])assert.equal(await v("select has_table_privilege($1,'icash_research_private.owner_export_diagnostic_slots','INSERT,UPDATE,DELETE,SELECT')",[role]),false);
 assert.match(sql,/pg_try_advisory_xact_lock\(hashtextextended\('dealmachine:organization:owner-export',0\)\)/);
 assert.equal((sql.match(/pg_try_advisory_xact_lock/g)||[]).length,2,'both directions share production lock');
 console.log('owner export diagnostic slot: passed isolated PostgreSQL approval, overlap, hold, wallet and ACL tests');
}finally{await db.close();}
