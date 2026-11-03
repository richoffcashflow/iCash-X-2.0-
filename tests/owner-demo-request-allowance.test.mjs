// Exact production lookup claim and quota-receipt bodies in an offline database.
// These tests make no provider requests and create no live consent or paid work.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=await PGlite.create(),q=(s,a=[])=>pg.query(s,a),one=async(s,a=[])=>(await q(s,a)).rows[0];
const val=async(s,a=[])=>Object.values(await one(s,a))[0];
const account='48dfb798-8c1a-404f-88c0-c396cc067062';
let scenarios=0;
const scenario=async(name,fn)=>{await pg.exec('begin');try{await fn();scenarios++;}catch(e){throw new Error(name+': '+e.message,{cause:e});}finally{await pg.exec('rollback');}};
async function lead(){const id=randomUUID();await q('select fixture_owner_demo_lead($1,$2)',[id,randomUUID()]);return id;}
const claim=id=>val('select icash_claim_owner_demo_lookup($1)',[id]);
const snapshot=async()=>({
 budget:(await q('select * from icash_dealmachine_request_budget')).rows,
 seller:(await q('select * from icash_seller_controls')).rows,
 wallet:(await q('select * from icash_wallets')).rows,
 leads:(await q('select * from icash_seller_intakes order by id')).rows,
 admissions:(await q('select * from icash_research_private.owner_demo_request_admissions order by lead_id')).rows,
 requests:(await q('select * from icash_research_private.requests order by id')).rows,
});
async function unchangedDenied(id){const before=await snapshot();assert.equal(await claim(id),null);assert.deepEqual(await snapshot(),before);}
try{
 await pg.exec(read('tests/fixtures/owner-demo-request-foundation.sql'));
 await pg.exec(read('config/owner-demo-request-allowance.sql'));
 await scenario('installation disabled without changing ordinary counters or costs',async()=>{const id=await lead();await unchangedDenied(id);assert.equal(await val('select day_used from icash_dealmachine_request_budget'),9800);});
 await pg.exec('update icash_research_private.owner_demo_request_policy set enabled=true');
 await scenario('one fresh exact owner request gets the normal funded claim and one counted request',async()=>{
  const id=await lead(),wallet=await q('select * from icash_wallets'),budget=await one('select * from icash_dealmachine_request_budget');
  const c=await claim(id);assert(c);assert.equal(c.id,id);assert.equal(c.noAddressFallback,true);assert.match(c.quotaRequestId,/^[0-9a-f-]{36}$/);assert.match(c.token,/^[0-9a-f-]{36}$/);
  const l=await one('select * from icash_seller_intakes where id=$1',[id]);
  assert.equal(l.state,'checking');assert.equal(l.claim_token,c.token);assert.equal(l.lookup_cap_micros,16000);assert.deepEqual(l.lookup_costs,{dealmachine:10000,vercel:3000,railway:3000,acquisition:0});
  const b=await one('select * from icash_dealmachine_request_budget');assert.equal(b.day_used,9801);assert.equal(b.minute_used,1);assert.equal(b.day_limit,9800);assert.equal(b.minute_limit,60);assert.deepEqual(b.day_start,budget.day_start);
  const controls=await one('select lookup_reserved_micros,lookup_used_micros from icash_seller_controls');assert.deepEqual(controls,{lookup_reserved_micros:16000,lookup_used_micros:0});assert.deepEqual((await q('select * from icash_wallets')).rows,wallet.rows);
  const a=await one('select * from icash_research_private.owner_demo_request_admissions');assert.equal(a.lead_id,id);assert.equal(a.lookup_token,c.token);assert.equal(a.quota_request_id,c.quotaRequestId);assert.equal(new Date(a.expires_at).toISOString(),new Date(c.demoExpiresAt).toISOString());assert.equal(a.source.address,l.address);
  const r=await one('select * from icash_research_private.requests where id=$1',[c.quotaRequestId]);assert.equal(r.admitted,true);assert.equal(r.kind,'property_lookup');assert.equal(r.account_id,account);assert.equal(r.operation_key,'owner-demo-lookup:'+id);assert.equal(r.finished_at,null);
  await unchangedDenied(id);await unchangedDenied(await lead());
 });
 const denials=[
  ['company pause','update icash_operating_budget set enabled=false'],
  ['seller controls disabled','update icash_seller_controls set enabled=false'],
  ['manual pause','update icash_accounts set bot_paused=true'],
  ['membership','update icash_accounts set membership_allowed=false'],
  ['unknown membership','update icash_accounts set membership_allowed=null'],
  ['acquisition gate','update icash_accounts set acquisition_allowed=false'],
  ['unacknowledged workspace','update icash_accounts set workspace_ack_version=null'],
  ['reserved wallet','update icash_wallets set reserved_cents=balance_cents'],
  ['billing review',"insert into icash_billing_reviews values('"+account+"',null)"],
  ['cancellation',"insert into icash_support_cancel_requests values('"+account+"',clock_timestamp())"],
  ['owner identity','update icash_accounts set owner_user_id=gen_random_uuid()'],
  ['ordinary quota still available','update icash_dealmachine_request_budget set day_used=9799'],
  ['already beyond local cap','update icash_dealmachine_request_budget set day_used=9801'],
  ['new user reserve refusal','update icash_dealmachine_request_budget set day_used=8820'],
  ['minute exhausted','update icash_dealmachine_request_budget set minute_used=60'],
  ['quota day expired',"update icash_dealmachine_request_budget set day_start=clock_timestamp()-interval '24 hours'"],
  ['quota day future',"update icash_dealmachine_request_budget set day_start=clock_timestamp()+interval '1 minute'"],
  ['minute future',"update icash_dealmachine_request_budget set minute_start=clock_timestamp()+interval '1 minute'"],
  ['negative minute counter','update icash_dealmachine_request_budget set minute_used=-1'],
  ['changed minute limit','update icash_dealmachine_request_budget set minute_limit=59'],
  ['changed day limit','update icash_dealmachine_request_budget set day_limit=10000'],
  ['provider cooldown',"update icash_research_private.quota_feedback set blocked_until=clock_timestamp()+interval '1 minute'"],
  ['provider metadata mismatch',"update icash_research_private.quota_feedback set headers=jsonb_set(headers,'{dayLimit}','20000')"],
  ['provider observation in future',"update icash_research_private.quota_feedback set observed_at=clock_timestamp()+interval '1 minute'"],
  ['provider evidence from earlier quota day',"update icash_research_private.requests set created_at=now()-interval '4 hours',finished_at=now()-interval '4 hours'+interval '1 second';update icash_research_private.quota_feedback set request_started_at=now()-interval '4 hours',observed_at=now()-interval '4 hours'+interval '1 second'"],
  ['source request not admitted','update icash_research_private.requests set admitted=false'],
  ['source request unfinished','update icash_research_private.requests set finished_at=null'],
  ['malformed source remaining',"update icash_research_private.requests set result=jsonb_set(result,'{dayRemaining}','\"invalid\"');update icash_research_private.quota_feedback set headers=jsonb_set(headers,'{dayRemaining}','\"invalid\"')"],
  ['source provider no remaining',"update icash_research_private.requests set result=jsonb_set(result,'{dayRemaining}','0');update icash_research_private.quota_feedback set headers=jsonb_set(headers,'{dayRemaining}','0')"],
  ['STOP',"insert into icash_text_suppressions values('+12142185280')"],
  ['contact suppression',"insert into icash_contact_suppressions values(encode(sha256(convert_to('+12142185280','UTF8')),'hex'))"],
 ];
 for(const [name,sql] of denials)await scenario(name+' preserves all work and money',async()=>{const id=await lead();await pg.exec(sql);await unchangedDenied(id);});
 const sourceDenials=[
  ["state='checking'"],["canonical_id=gen_random_uuid()"],["phone='+12145550123'"],["ai_consented=false"],["consent_version='old'"],["consent_text='invented'"],["contact_consent_scope='homeoffer_network_and_matched_buyers'"],["attribution=jsonb_set(attribution,'{demoAccountId}',to_jsonb(gen_random_uuid()::text))"],["attribution=jsonb_set(attribution,'{source}','\"other\"')"],["claim_token=gen_random_uuid()"],["claimed_at=now()"],["checked_at=now()"],["lookup_costs='{}'"],["lookup_cap_micros=0"],["lookup_cost_basis='prior attempt'"],["property='{}'"],["result='{}'"],["operation_key='prior'"],["assigned_account='"+account+"'"],["screening_id=gen_random_uuid()"],["address='Outside allowed states'"],
 ];
 for(const [set] of sourceDenials)await scenario('source mutation '+set,async()=>{const id=await lead();await q('update icash_seller_intakes set '+set+' where id=$1',[id]);await unchangedDenied(id);});
 for(const set of ["request_id=gen_random_uuid()","phone='+12145550123'","account_id=gen_random_uuid()","requested_by=gen_random_uuid()","source='support_request'","request_version='old'","request_reference='old'","request_text='different'","expires_at=requested_at+interval '6 minutes'","requested_at=clock_timestamp()+interval '1 minute',expires_at=clock_timestamp()+interval '6 minutes'"])
  await scenario('fresh call request binding '+set,async()=>{const id=await lead();await q('update icash_optin_call_requests set '+set+' where lead_id=$1',[id]);await unchangedDenied(id);});
 await scenario('expired request is never renewed',async()=>{const id=await lead();await q("update icash_seller_intakes set created_at=now()-interval '7 minutes' where id=$1",[id]);await q("update icash_optin_call_requests set requested_at=now()-interval '6 minutes',expires_at=now()-interval '1 minute' where lead_id=$1",[id]);await unchangedDenied(id);});
 await scenario('match and original operation are never replayed',async()=>{const id=await lead();await q('insert into icash_seller_matches values($1,$2,gen_random_uuid())',[id,account]);await unchangedDenied(id);await pg.exec('delete from icash_seller_matches');await q('insert into icash_operation_spend values($1)',['seller-lead:'+id+':'+account]);await unchangedDenied(id);});
 await scenario('ordinary claim rejection rolls back its stale housekeeping',async()=>{const id=await lead(),old=await lead();await q("update icash_seller_intakes set state='checking',claimed_at=now()-interval '3 minutes' where id=$1",[old]);await pg.exec('update icash_seller_controls set lookup_allowance_micros=0');await unchangedDenied(id);});
 await scenario('ordinary claim wrong-source return rolls back source and reserve',async()=>{
  const id=await lead();await pg.exec(`alter function icash_claim_seller_lookup_for(uuid) rename to fixture_original_claim;
  create function icash_claim_seller_lookup_for(uuid) returns jsonb language plpgsql as $$declare c jsonb;begin c:=public.fixture_original_claim($1);return c||jsonb_build_object('id',gen_random_uuid());end$$;`);await unchangedDenied(id);
 });
 await scenario('ordinary claim malformed token rolls back source and reserve',async()=>{
  const id=await lead();await pg.exec(`alter function icash_claim_seller_lookup_for(uuid) rename to fixture_original_claim;
  create function icash_claim_seller_lookup_for(uuid) returns jsonb language plpgsql as $$declare c jsonb;begin c:=public.fixture_original_claim($1);return c||jsonb_build_object('token','bad');end$$;`);await unchangedDenied(id);
 });
 await scenario('expired minute resets only on a successful claim',async()=>{const id=await lead();await pg.exec("update icash_dealmachine_request_budget set minute_start=now()-interval '2 minutes',minute_used=60");assert(await claim(id));assert.equal(await val('select minute_used from icash_dealmachine_request_budget'),1);});
 await scenario('unknown outcome retains consumed allowance and original money hold',async()=>{const id=await lead(),c=await claim(id);assert(c);await q('select icash_finish_dealmachine_request($1,$2)',[c.quotaRequestId,{outcome:'unknown'}]);const s=await snapshot();await unchangedDenied(id);await unchangedDenied(await lead());assert.equal(await val('select count(*)::integer from icash_research_private.owner_demo_request_admissions'),1);assert.equal(await val('select lookup_reserved_micros from icash_seller_controls'),s.seller[0].lookup_reserved_micros);});
 await scenario('429 extends ordinary provider cooldown and never releases the allowance',async()=>{const id=await lead(),c=await claim(id);assert(c);assert.equal(await val('select icash_finish_dealmachine_request($1,$2)',[c.quotaRequestId,{outcome:'http_error',httpStatus:429,retryAfter:120}]),true);assert.equal(await val('select icash_dealmachine_provider_available()'),false);await unchangedDenied(await lead());});
 await scenario('immutable admission survives counter drift and cannot be edited',async()=>{const id=await lead();assert(await claim(id));await pg.exec('update icash_dealmachine_request_budget set day_used=9800');await unchangedDenied(await lead());await assert.rejects(pg.exec('update icash_research_private.owner_demo_request_admissions set phone=phone'),/immutable/);});
 for(const role of ['anon','authenticated'])assert.equal(await val("select has_function_privilege($1,'icash_claim_owner_demo_lookup(uuid)','execute')",[role]),false);
 assert.equal(await val("select has_function_privilege('service_role','icash_claim_owner_demo_lookup(uuid)','execute')"),true);
 for(const table of ['owner_demo_request_policy','owner_demo_request_admissions'])for(const role of ['anon','authenticated','service_role'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal(await val('select has_table_privilege($1,$2,$3)',[role,'icash_research_private.'+table,privilege]),false);
 assert.equal(await val("select prosecdef from pg_proc where oid='icash_claim_owner_demo_lookup(uuid)'::regprocedure"),true);
 console.log(`Owner demo request allowance: ${scenarios} offline database scenarios passed; one real ordinary lookup reservation, original quota counters, current owner consent, provider cooldown, immutable consumption and private ACLs. No provider traffic.`);
}finally{await pg.close();}
