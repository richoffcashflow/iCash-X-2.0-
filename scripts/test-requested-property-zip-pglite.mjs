/** SIMULATION ONLY. Exact requested ZIP lookup; actual SQL/services, no external requests. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createJourneyDb,read} from '../tests/helpers/simulated-journey-db.mjs';
import {databaseAdapter,loadService} from '../tests/helpers/simulated-journey-services.mjs';
import {discoveryWorkEnabled,contactWorkEnabled,liveWorkReady} from '../lib/live-work-admission.ts';
import {discoverPage} from '../lib/discovery-pipeline.ts';
import {validateCostManifest} from '../lib/cost-manifest.ts';
const {pg,notices}=await createJourneyDb(process.argv[2]);const {db,rpc,q}=databaseAdapter(pg);
const one=async(sql,args=[])=>{const {rows}=await q(sql,args);assert.equal(rows.length,1);return rows[0];};
const oldFetch=globalThis.fetch;let geoRequests=0,paid=0,estimateMutation=null;
Object.assign(process.env,{ICASH_LIVE_WORK_READY:'true',DEALMACHINE_API_KEY:'dm_sk_live_SIMULATION_NO_NETWORK'});
try{
 await pg.exec(read('config/research-contract-separation.sql'));
 const signature=(await one("select md5(pg_get_functiondef('icash_begin_signing(uuid,uuid,uuid,text,uuid,text,jsonb)'::regprocedure)) hash")).hash;
 await pg.exec(read('config/requested-property-zip-resolution.sql'));await pg.exec(read('config/requested-property-zip-resolution.sql'));
 assert.equal((await one("select md5(pg_get_functiondef('icash_begin_signing(uuid,uuid,uuid,text,uuid,text,jsonb)'::regprocedure)) hash")).hash,signature);
 assert.equal((await one('select count(*)::int n from icash_property_zip_geographies')).n,0,'Migration cannot seed fabricated geography');
 const user=randomUUID(),other=randomUUID();await q("insert into auth.users(id,email,email_confirmed_at) values($1,'zip@example.invalid',now()),($2,'otherzip@example.invalid',now())",[user,other]);
 const unfunded=await rpc('icash_create_account',{p_user:other});
 assert.equal((await rpc('icash_claim_requested_property_zip',{p_user:other,p_account:unfunded})).status,'funding_required');
 const guest='d'.repeat(64),setup=await rpc('icash_init_bot_setup',{p_guest:guest});
 await rpc('icash_save_bot_setup',{p_setup:setup.id,p_revision:0,p_profile:{displayName:'Fixture',marketMode:'city',market:'94103'},p_stage:4});
 const order=(await one("insert into icash_funding_orders(mode,guest_hash,pack_code,price_cents,credit_cents) values('live',$1,'work',300,300) returning id",[guest])).id;
 await rpc('icash_settle_funding',{p_order:order,p_mode:'live',p_session:'cs_live_SIMULATION_ZIP',p_payment:'pi_SIMULATION_ZIP',p_amount:300,p_email:'zip@example.invalid',p_phone:null});
 const account=await rpc('icash_claim_funding',{p_user:user,p_mode:'live'});
 assert.equal((await one('select account_id from icash_bot_setups where id=$1',[setup.id])).account_id,account,'Funding trigger binds the real setup before choosing a default market');
 assert.equal((await one('select count(*)::int n from icash_discovery_configs where account_id=$1',[account])).n,0,'Never silently substitute a shortlist ZIP for an unresolved explicit request');
 const initial=await one('select bot_paused,daily_limit_cents from icash_accounts where id=$1',[account]);assert.equal(initial.bot_paused,true);
 const walletBefore=await one('select * from icash_wallets where account_id=$1',[account]);
 await assert.rejects(()=>rpc('icash_claim_requested_property_zip',{p_user:other,p_account:account}),/ownership/);
 const service=await loadService('lib/requested-property-market.ts',{db,discoveryWorkEnabled});
 globalThis.fetch=async(url,options)=>{
  if(String(url).startsWith('https://api.v2.dealmachine.com/v1/locations?')){
   geoRequests++;assert.equal(url,'https://api.v2.dealmachine.com/v1/locations?q=94103&type=zip_code&per_page=100&page=1');assert.equal(options.method,'GET');
   return Response.json({data:[{location_id:'loc_zip_code_94103',type:'zip_code',code:'94103',name:'San Francisco',state:'CA',property_count:15000}],pagination:{page:1,total_pages:1}});
  }
  assert.equal(url,'https://api.v2.dealmachine.com/v1/properties/search');const body=JSON.parse(options.body);assert.equal(body.locations[0].code,'94103');assert.equal(body.contact_audience,'none');assert.equal(body.per_page,5);
  if(body.estimate_cost){if(estimateMutation){const mutate=estimateMutation;estimateMutation=null;await mutate();}return Response.json({estimated_credits:{this_page:1,breakdown:{people:0}}});}
  paid++;return Response.json({data:[{dm_property_id:'prop_94103',full_address:'Fixture property, San Francisco CA 94103',state:'CA',zip:'94103'}],credits:{used:1,people:0},pagination:{has_next_page:true}});
 };
 assert.equal((await service.resolveRequestedPropertyMarket(account,user)).status,'configured');assert.equal(geoRequests,1);assert.equal(paid,0);
 assert.equal((await service.resolveRequestedPropertyMarket(account,user)).status,'configured');assert.equal(geoRequests,1,'Cached result needs no second provider lookup');
 const config=await one('select * from icash_discovery_configs where account_id=$1',[account]);assert.equal(config.zip,'94103');
 assert.deepEqual(await one('select bot_paused,daily_limit_cents from icash_accounts where id=$1',[account]),initial);
 assert.deepEqual(await one('select * from icash_wallets where account_id=$1',[account]),walletBefore);
 assert.equal((await one('select count(*)::int n from icash_inventory_markets where account_id=$1',[account])).n,1,'Explicit requested ZIP must not start nationwide scans');
 assert.equal((await one('select count(*)::int n from icash_market_shortlist')).n,15,'Default shortlist stays unchanged');
 await q('begin');try{await q('update icash_discovery_configs set enabled=false,auto_enabled=false where account_id=$1',[account]);assert.equal((await service.resolveRequestedPropertyMarket(account,user)).status,'configured');const held=await one('select enabled,auto_enabled from icash_discovery_configs where account_id=$1',[account]);assert.equal(held.enabled,false);assert.equal(held.auto_enabled,false);}finally{await q('rollback');}
 assert.equal((await one('select count(*)::int n from icash_signing_templates')).n,0);
 assert.equal((await one('select count(*)::int n from icash_operation_spend')).n,0);
 assert.equal((await one('select count(*)::int n from icash_contact_permissions')).n,0);
 const market=await loadService('lib/contract-coverage-service.ts',{db});
 assert.equal(await market.propertyResearchMarketKnown('94103',account),true);
 assert.equal(await market.propertyResearchMarketKnown('38118',account),false,'Explicit requested ZIP binds research; no fallback paid market');
 assert.equal(await rpc('icash_property_research_market_ready',{p_account:account,p_zip:'94103'}),true);
 await q('begin');try{
  await q("update icash_property_zip_geographies set expires_at=now()-interval '1 second' where zip='94103'");
  assert.equal(await market.propertyResearchMarketKnown('94103',account),false);
  const claim=await rpc('icash_claim_requested_property_zip',{p_user:user,p_account:account});assert.equal(claim.status,'lookup_required');
  assert.equal((await rpc('icash_claim_requested_property_zip',{p_user:user,p_account:account})).status,'market_lookup_held');
  const geo={location_id:'loc_zip_code_94103',type:'zip_code',code:'94103',name:'Fixture',state:'CA',property_count:1};
  assert.equal((await rpc('icash_save_requested_property_zip',{p_user:user,p_account:account,p_zip:'94103',p_token:randomUUID(),p_location:geo})).status,'stale_lookup');
  await q('savepoint invalid_geo');
  await assert.rejects(()=>rpc('icash_save_requested_property_zip',{p_user:user,p_account:account,p_zip:'94103',p_token:claim.token,p_location:{...geo,state:'ZZ'}}),/Exact provider US ZIP/);
  await q('rollback to invalid_geo');
  assert.equal((await rpc('icash_save_requested_property_zip',{p_user:user,p_account:account,p_zip:'94103',p_token:claim.token,p_location:null})).status,'provider_market_unavailable');
  assert.equal(await market.propertyResearchMarketKnown('94103',account),false);
  assert.equal((await rpc('icash_claim_requested_property_zip',{p_user:user,p_account:account})).status,'market_lookup_held');
 }finally{await q('rollback');}
 // Profile changes cannot alter an existing configuration or authorize a paid fallback.
 await q('begin');try{
  await q("update icash_bot_setups set profile=profile||'{\"market\":\"35206\"}'::jsonb where account_id=$1",[account]);
  assert.equal((await rpc('icash_provision_funded_account',{p_account:account})).status,'existing_market_configuration_preserved');
  assert.equal((await one('select zip from icash_discovery_configs where account_id=$1',[account])).zip,'94103');
  assert.equal(await market.propertyResearchMarketKnown('94103',account),false);
 }finally{await q('rollback');}
 const costs=await loadService('lib/operating-costs.ts',{db,validateCostManifest,discoveryWorkEnabled,contactWorkEnabled,liveWorkReady});
 const discovery=await loadService('lib/discovery-service.ts',{db,discoveryWorkEnabled,liveWorkReady,dispatchReservedOperation:costs.dispatchReservedOperation,discoverPage,propertyResearchMarketKnown:market.propertyResearchMarketKnown});
 assert.equal((await discovery.discoverForAccount(account)).status,'paused');assert.equal(paid,0);
 await q('update icash_operating_budget set enabled=true,require_company_reserve=false');
 await q('update icash_accounts set daily_limit_cents=300 where id=$1',[account]);
 await q('insert into icash_spend_activations(account_id,enabled,customer_cap_cents) values($1,true,300)',[account]);
 await rpc('icash_set_work_control',{p_user:user,p_account:account,p_action:'resume'});
 await q('begin');try{await q('update icash_wallets set balance_cents=83 where account_id=$1',[account]);await assert.rejects(()=>discovery.discoverForAccount(account),/Insufficient credits/);assert.equal(paid,0);}finally{await q('rollback');}
 // The original reviewer repro changes the saved request during the free estimate.
 // Every mutable scope input is now revalidated under locks in the atomic paid claim.
 const mutations=[
  ["saved requested ZIP", "update icash_bot_setups set profile=profile||'{\"market\":\"35206\"}'::jsonb where account_id=$1"],
  ["setup revision", 'update icash_bot_setups set revision=revision+1 where account_id=$1'],
  ["geography expiry", "update icash_property_zip_geographies set expires_at=clock_timestamp()-interval '1 second' where zip=(select zip from icash_discovery_configs where account_id=$1)"],
  ["config revision", 'update icash_discovery_configs set revision=gen_random_uuid() where account_id=$1'],
  ["config page", 'update icash_discovery_configs set next_page=next_page+1 where account_id=$1'],
  ["config rate", "update icash_discovery_configs set rate_id=(select id from icash_operation_rates where operation='owner_enrichment' limit 1) where account_id=$1"],
  ["config quantity", 'update icash_discovery_configs set per_page=6 where account_id=$1'],
  ["config unit", 'update icash_discovery_configs set property_credit_micros=property_credit_micros+1 where account_id=$1'],
  ["config rights", "update icash_discovery_configs set data_rights_until=data_rights_until-interval '1 minute' where account_id=$1"],
  ["operator hold", 'update icash_discovery_configs set auto_enabled=false where account_id=$1'],
 ];
 for(const [label,sql] of mutations){await q('begin');try{
  estimateMutation=()=>q(sql,[account]);
  assert.equal((await discovery.discoverForAccount(account)).status,'held',label);
  assert.equal(paid,0,label+' must never dispatch a paid provider request');
  assert.equal((await one('select count(*)::int n from icash_operation_spend where account_id=$1',[account])).n,0,label+' must not leave a reservation');
  assert.equal((await one('select reserved_cents::int n from icash_wallets where account_id=$1',[account])).n,0);
 }finally{estimateMutation=null;await q('rollback');}}
 assert.equal((await discovery.discoverForAccount(account)).status,'screening_queued');assert.equal(paid,1);
 assert.equal((await one('select charge_cap_cents::int n from icash_operation_spend where account_id=$1',[account])).n,84);
 for(const role of ['anon','authenticated']){
  assert.equal((await one("select has_table_privilege($1,'icash_property_zip_geographies','select') exposed",[role])).exposed,false);
  assert.equal((await one("select has_function_privilege($1,'icash_claim_requested_property_zip(uuid,uuid)','execute') exposed",[role])).exposed,false);
  assert.equal((await one("select has_function_privilege($1,'icash_reserve_and_claim_property_discovery(uuid,text,uuid,integer,integer,uuid,bigint,timestamptz,integer,text,text)','execute') exposed",[role])).exposed,false);
 }
 assert(!notices.some(n=>n.includes('Funded account provisioning deferred')));
 console.log('SIMULATED PASS: exact funded customer ZIP 94103 resolves from one free provider metadata GET, caches actual CA geography, provisions only that ZIP, preserves pause/budget/credits and Start; real discovery retains $0.84 reserve; no shortlist expansion/templates/consent; ownership/token/expiry/unknown/negative-cache/profile-change holds, ten estimate-to-claim mutations held with zero paid requests/reservations, and service-only ACL. No external requests.');
}catch(e){console.error('SIMULATED_ZIP_FAILED',e.message,e.where??'');process.exitCode=1;}finally{globalThis.fetch=oldFetch;await pg.close();}
