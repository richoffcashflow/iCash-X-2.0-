import assert from 'node:assert/strict';

// The real continuation and late-receipt writer run against synthetic rows.
export async function independentSearchScenarios(db,account,other,op,request){
 const q=(s,a=[])=>db.query(s,a);
 const value=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
 const config=()=>value('select to_jsonb(c) from icash_discovery_configs c where account_id=$1',[account]);
 const resume=()=>value('select icash_continue_stalled_research($1)',[account]);
 const policy={version:'research-efficiency-v2',exclusionListId:'00000000-0000-4000-8000-000000000199'};
 const plan={version:'seller-targeting-v1',strategy:'target_00000000-0000-4000-8000-000000000198',mode:'explore',providerPage:1,targeting:{id:'00000000-0000-4000-8000-000000000198',asOf:'2026-11-01',segment:'off_market_repairs'}};
 await db.exec('begin;');
 await q('update icash_discovery_configs set research_list_id=null where account_id=$1',[account]);
 await q('update icash_research_private.query_claims set policy=$2 where operation_key=$1',[op,policy]);
 await q('update icash_discovery_filter_pages set plan=$2 where operation_key=$1',[op,plan]);
 assert.equal(await resume(),false,'New query family starts disabled');
 await db.exec('update icash_research_private.settings set independent_query_continuation_enabled=true');
 const denied=async(sql,args,message)=>{
  await db.exec('savepoint denied_case;');await q(sql,args);
  assert.equal(await resume(),false,message);await db.exec('rollback to savepoint denied_case;');
 };
 await denied('update icash_research_private.query_claims set policy=$2 where operation_key=$1',[op,{...policy,exclusionListId:null}],'An absent immutable list is not sufficient evidence');
 await denied('update icash_research_private.query_claims set policy=$2 where operation_key=$1',[op,{...policy,version:'financial-prefilter-v1'}],'Other unknown query families remain held');
 await denied("update icash_discovery_filter_pages set plan=jsonb_set(plan,'{version}','\"seller-filters-v1\"') where operation_key=$1",[op],'A different filter family is not reclassified');
 await denied('update icash_discovery_filter_pages set account_id=$2 where operation_key=$1',[op,other],'Foreign source evidence cannot authorize recovery');
 await denied('update icash_discovery_filter_pages set revision=gen_random_uuid() where operation_key=$1',[op],'A stale filter snapshot cannot authorize recovery');
 await denied('update icash_accounts set bot_paused=true where id=$1',[account],'Customer Pause wins');
 await denied('update icash_discovery_configs set auto_enabled=false where account_id=$1',[account],'Automatic work controls win');
 await denied('update icash_wallets set balance_cents=0 where account_id=$1',[account],'An unfunded account cannot continue');
 await denied('update icash_research_private.requests set finished_at=now() where id=$1',[request],'A current handler is not rotated');
 await denied("insert into icash_bot_setups(account_id,guest_hash,variant,revision,profile) values($1,repeat('a',64),'ownership',1,'{\"marketMode\":\"city\",\"market\":\"75217\"}') on conflict(account_id) do update set profile=excluded.profile",[account],'Explicit geographic controls are preserved');
 // No estimate survives in this fixture: immutable claim/page evidence suffices.
 assert.equal(await value('select count(*)::int from icash_research_private.estimates where operation_key=$1',[op]),0);
 await denied("insert into icash_operation_spend(operation_key,account_id,rate_id,credit_reservation_id,charge_cap_cents,reserved_micros,state,permission_until) values('discovery:unscoped',$1,$2,gen_random_uuid(),50,100000,'dispatched','2099-01-01')",[other,(await config()).rate_id],'Unscoped unknowns block every alternative');
 await db.exec('savepoint shared_scope;');
 await q("insert into icash_operation_spend(operation_key,account_id,rate_id,credit_reservation_id,charge_cap_cents,reserved_micros,state,permission_until) values('discovery:other-scope',$1,$2,gen_random_uuid(),50,100000,'dispatched','2099-01-01')",[other,(await config()).rate_id]);
 await q("insert into icash_research_private.estimates values('discovery:other-scope',$1,'{\"locations\":[{\"type\":\"zip_code\",\"code\":\"75001\"}]}')",[other]);
 assert.equal(await resume(),false,'A different account\'s unknown excludes that alternative ZIP');
 await db.exec('rollback to savepoint shared_scope;');
 const original=await config();
 const before=(await q('select * from icash_operation_spend order by operation_key')).rows;
 const wallet=(await q('select * from icash_wallets order by account_id')).rows;
 const originalRequest=await value('select to_jsonb(r) from icash_research_private.requests r where id=$1',[request]);
 assert.equal(await resume(),true,'Independent targeting timeout continues without a configuration list');
 const next=await config();assert.equal(next.zip,'75001');assert.notEqual(next.revision,original.revision);
 assert.equal(await resume(),false,'Recovery is once-only for the original operation');
 assert.deepEqual(await value('select configuration from icash_research_private.stalled_searches where operation_key=$1',[op]),original);
 assert.deepEqual((await q('select * from icash_operation_spend order by operation_key')).rows,before,'Original money holds remain unchanged');
 assert.deepEqual((await q('select * from icash_wallets order by account_id')).rows,wallet);
 assert.deepEqual(await value('select to_jsonb(r) from icash_research_private.requests r where id=$1',[request]),originalRequest);
 assert.equal(await value('select icash_stalled_research_zip($1,$2)',[account,original.zip]),true,'The uncertain original market remains fenced');
 const receipt={queryPolicy:policy,filterPlan:plan,rows:[{dm_property_id:'prop_9002',full_address:'Synthetic delayed targeting result',state:'TX',zip:original.zip}],creditsUsed:1,peopleCredits:0,estimatedCredits:1,hasNextPage:true,fetchedAt:new Date().toISOString()};
 assert.equal(await value('select icash_save_research_discovery($1,$2,$3,$4,$5)',[account,op,original.revision,original.next_page,receipt]),1,'The exact late independent-query receipt remains recoverable');
 assert.deepEqual(await config(),next,'A late original result cannot overwrite new progress');
 assert.equal(await value('select icash_save_research_discovery($1,$2,$3,$4,$5)',[account,op,original.revision,original.next_page,receipt]),1,'Repeated late persistence is idempotent');
 assert.equal(await value('select count(*)::int from icash_screening_jobs where event_key=$1',[op+':prop_9002']),1);
 await db.exec('rollback;');
 console.log('Independent targeting timeout: exact family, customer controls, global scope fences, immutable holds and late receipts passed.');
}
