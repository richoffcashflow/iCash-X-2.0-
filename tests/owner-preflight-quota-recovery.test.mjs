import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8'),pg=new PGlite(),q=(s,a=[])=>pg.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,a=id(1),s=id(2),items=[{screeningId:s,snapshot:{propertyId:'prop_2'},ids:['per_2']}],request={people_ids:['per_2'],property_match:'owner',anchor:'person',require_phone:true,scrub_dnc:true,active_phones_only:true};
const claim=()=>v('select icash_claim_owner_preflight($1,$2,$3)',[a,items,request]);
const defer=(c,n,step='create')=>v('select icash_defer_owner_preflight_quota($1,$2,$3,$4)',[c.id,c.lease,step,id(n)]);
const addRequest=async(c,n,{step='create',admitted=false,account=a,key,age=false}={})=>q("insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,result,created_at) values($1,'owner_preview',$2,$3,$4,$5,case when $6 then now()-interval '1 hour' else clock_timestamp() end)",[id(n),account,key??'owner-preflight:'+c.id+':'+step,admitted,admitted?{outcome:'unknown'}:{outcome:'quota_wait'},age]);
try{
 await pg.exec(read('tests/fixtures/owner-preflight-foundation.sql'));
 await pg.exec(read('config/owner-export-preflight.sql'));
 await pg.exec(read('tests/fixtures/owner-preflight-quota.sql'));
 await pg.exec(read('config/owner-preflight-quota-recovery.sql'));
 await q('insert into icash_accounts values($1,false)',[a]);await q("insert into icash_screening_jobs values($1,$2,'complete',$3)",[s,a,items[0].snapshot]);await q('insert into fixture_recovery_gates(account_id,eligible) values($1,true)',[a]);await pg.exec('update icash_research_private.owner_export_settings set preflight_enabled=true,preflight_quota_recovery_enabled=true');
 let c=await claim();assert.equal(c.status,'create');
 // Reproduce capacity observed at claim, then lost before transport. No provider
 // receipt exists; only the limiter's exact locally-denied request can recover.
 await addRequest(c,10,{admitted:true});assert.equal(await defer(c,10),false,'Admitted unknown request cannot recover');await q('delete from icash_research_private.requests where id=$1',[id(10)]);
 for(const [n,opts] of [[11,{account:id(99)}],[12,{key:'owner-preflight:foreign:create'}],[13,{age:true}]]){await addRequest(c,n,opts);assert.equal(await defer(c,n),false);}
 await addRequest(c,14);assert.equal(await defer({...c,lease:id(98)},14),false,'Stale lease');
 assert.equal(await defer(c,14),true);assert.equal(await defer(c,14),true,'Lost DB ACK retries identical denial');
 assert.equal((await claim()).status,'pending','Existing ticket backoff is honored');
 // Fixture clock travel is limited to immutable denial setup; then restore guard.
 await pg.exec('alter table icash_research_private.owner_preflight_quota_deferrals disable trigger owner_preflight_quota_immutable;update icash_research_private.owner_preflight_quota_deferrals set created_at=now()-interval \'31 seconds\';alter table icash_research_private.owner_preflight_quota_deferrals enable trigger owner_preflight_quota_immutable');
 const before=await v('select receipts from icash_research_private.owner_export_preflights where id=$1',[c.id]);
 await pg.exec('update fixture_recovery_gates set eligible=false');assert.equal((await claim()).status,'held','Current funds/holds gate still wins');await pg.exec('update fixture_recovery_gates set eligible=true');
 await pg.exec('update icash_accounts set bot_paused=true');assert.equal((await claim()).status,'held','Customer Pause wins');await pg.exec('update icash_accounts set bot_paused=false');
 const resumed=await claim();assert.equal(resumed.status,'create');assert.notEqual(resumed.lease,c.lease);assert.equal((await claim()).status,'pending','Repeated scheduler calls do not claim twice');
 assert.deepEqual(await v('select receipts from icash_research_private.owner_export_preflights where id=$1',[c.id]),before);
 assert.equal(await defer(c,14),false,'Old handler cannot defer reissued capability');
 assert.equal(await v('select count(*)::int from fixture_purchases'),0);
 await assert.rejects(q('delete from icash_research_private.owner_preflight_quota_deferrals'),/immutable/);
 // A response after a local refusal changes evidence and must fence recovery.
 const raw={data:{list_id:'exact-list',name:resumed.name,source_type:'people',status:'completed',total_count:1}};
 assert.equal(await v('select icash_record_owner_preflight($1,$2,\'create\',$3)',[c.id,resumed.lease,{httpStatus:200,raw,rawText:JSON.stringify(raw)}]),'pending');
 await q('update icash_research_private.owner_export_preflights set next_check_at=now() where id=$1',[c.id]);c=await claim();assert.equal(c.status,'check');
 const count={total_people:1,total_results:1,total_properties:1};assert.equal(await v("select icash_record_owner_preflight($1,$2,'baseline',$3)",[c.id,c.lease,{httpStatus:200,raw:count,rawText:JSON.stringify(count)}]),'checking');
 await addRequest(c,20,{step:'eligible'});assert.equal(await defer(c,20,'eligible'),true);
 await pg.exec('alter table icash_research_private.owner_preflight_quota_deferrals disable trigger owner_preflight_quota_immutable;update icash_research_private.owner_preflight_quota_deferrals set created_at=now()-interval \'31 seconds\';alter table icash_research_private.owner_preflight_quota_deferrals enable trigger owner_preflight_quota_immutable');
 const baseline=await v('select receipts from icash_research_private.owner_export_preflights where id=$1',[c.id]),started=await v('select started_at from icash_research_private.owner_export_preflights where id=$1',[c.id]);
 const eligible=await claim();assert.equal(eligible.nextStep,'eligible');assert.deepEqual(await v('select receipts from icash_research_private.owner_export_preflights where id=$1',[c.id]),baseline);assert.equal(String(await v('select started_at from icash_research_private.owner_export_preflights where id=$1',[c.id])),String(started),'Do not renew original baseline freshness');
 for(const role of ['anon','authenticated','service_role'])assert.equal(await v("select has_function_privilege($1,'icash_defer_owner_preflight_quota(uuid,uuid,text,uuid)','execute')",[role]),role==='service_role');
 await q("update icash_research_private.requests set created_at=now()-interval '31 days' where id in ($1,$2)",[id(14),id(11)]);assert.equal(await v('select icash_prune_research_requests()'),1);assert.equal(await v('select count(*)::int from icash_research_private.requests where id=$1',[id(14)]),1,'Permanent denial evidence survives ordinary diagnostic pruning');
 console.log('PASS quota preflight recovery: exact durable local denial only, immutable evidence, no provider replay, lease rotation, current eligibility/Pause, baseline freshness and private ACLs.');
}finally{await pg.close();}
