/** SIMULATION ONLY. Actual discovery services/RPCs in ephemeral PostgreSQL; every provider request is intercepted. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {createJourneyDb} from '../tests/helpers/simulated-journey-db.mjs';
import {databaseAdapter,loadService} from '../tests/helpers/simulated-journey-services.mjs';
import {discoveryWorkEnabled,liveWorkReady,automationWorkReady,newLiveWorkKinds,deferUnstartedAutomation} from '../lib/live-work-admission.ts';
import {contractCapability,reviewedContractCoverage} from '../lib/contract-coverage.ts';
import {discoverPage} from '../lib/discovery-pipeline.ts';
import {validateCostManifest} from '../lib/cost-manifest.ts';
import {tick} from '../worker/runner.mjs';
const {pg}=await createJourneyDb(process.argv[2]);const {db,rpc,q}=databaseAdapter(pg);
const one=async(sql,args=[])=>{const {rows}=await q(sql,args);assert.equal(rows.length,1);return rows[0];};
const oldFetch=globalThis.fetch;let estimates=0,paid=0,timeout=false;
Object.assign(process.env,{ICASH_LIVE_WORK_READY:'false',ICASH_SMS_WORK_READY:'false',ICASH_DISCOVERY_WORK_READY:'true',DEALMACHINE_API_KEY:'dm_sk_live_SIMULATION_NO_NETWORK'});
try{
 const user=randomUUID();await q("insert into auth.users(id,email,email_confirmed_at) values($1,'discovery@example.invalid',now())",[user]);
 const order=(await one("insert into icash_funding_orders(mode,guest_hash,pack_code,price_cents,credit_cents) values('live',$1,'work',300,300) returning id",['e'.repeat(64)])).id;
 await rpc('icash_settle_funding',{p_order:order,p_mode:'live',p_session:'cs_live_SIMULATION_DISCOVERY',p_payment:'pi_SIMULATION_DISCOVERY',p_amount:300,p_email:'discovery@example.invalid',p_phone:null});
 const account=await rpc('icash_claim_funding',{p_user:user,p_mode:'live'});
 await q('update icash_accounts set daily_limit_cents=300 where id=$1',[account]);
 await q('update icash_operating_budget set enabled=true,require_company_reserve=false');
 await q('insert into icash_spend_activations(account_id,enabled,customer_cap_cents) values($1,true,300)',[account]);
 await q('update icash_screening_control set enabled=true');
 const rate=(await one("select id from icash_operation_rates where operation='property_search' and enabled")).id;
 const ownerRate=(await one("select id from icash_operation_rates where operation='owner_enrichment' and enabled")).id;
 const config=await one("insert into icash_discovery_configs(account_id,enabled,auto_enabled,zip,rate_id,property_credit_micros,data_rights_until,seller_cost_reserve_cents,per_page,contacts_enabled,contact_rate_id) values($1,true,true,'38118',$2,10000,now()+interval '1 day',0,5,true,$3) returning *",[account,rate,ownerRate]);
 const costs=await loadService('lib/operating-costs.ts',{db,validateCostManifest,discoveryWorkEnabled,liveWorkReady});
 const market=await loadService('lib/contract-coverage-service.ts',{db,contractCapability,reviewedContractCoverage});
 assert.equal(await market.propertyResearchMarketKnown('38118'),true);
 assert.equal((await market.acquisitionContractCoverage('38118')).supported,false,'No Tennessee contract templates exist in this fixture');
 const discovery=await loadService('lib/discovery-service.ts',{db,discoveryWorkEnabled,liveWorkReady,dispatchReservedOperation:costs.dispatchReservedOperation,discoverPage,...market});
 globalThis.fetch=async(url,options)=>{
  assert.equal(url,'https://api.v2.dealmachine.com/v1/properties/search');const b=JSON.parse(options.body);
  assert.equal(b.per_page,5);assert.equal(b.contact_audience,'none');assert.equal(b.anchor,'properties');
  if(b.estimate_cost){estimates++;return Response.json({estimated_credits:{this_page:5,breakdown:{people:0}}});}
  paid++;if(timeout)throw Error('SIMULATION timeout after claim');
  return Response.json({data:Array.from({length:5},(_,i)=>({dm_property_id:`prop_${10000+i}`,full_address:`${i+1} Simulation Lane, Memphis TN 38118`,address:`${i+1} Simulation Lane`,city:'Memphis',state:'TN',zip:'38118',estimated_value:200000,estimated_repair_cost:40000,total_estimated_loan_balance:50000,estimated_equity_percentage:75})),credits:{used:5,people:0},pagination:{has_next_page:false}});
 };
 assert.equal((await discovery.discoverForAccount(account)).status,'paused');assert.equal(estimates,0);
 process.env.ICASH_LIVE_WORK_READY='true';assert.equal((await discovery.discoverForAccount(account)).status,'contract_coverage_required');process.env.ICASH_LIVE_WORK_READY='false';
 await q('begin');try{await q("update icash_discovery_configs set zip='00000' where account_id=$1",[account]);assert.equal((await discovery.discoverForAccount(account)).status,'market_configuration_required');assert.equal(estimates,0);}finally{await q('rollback');}
 Object.assign(process.env,{DOCUSEAL_MODE:'live',DOCUSEAL_API_KEY:'SIMULATION_NO_NETWORK'});
 const signing=await loadService('lib/signing-service.ts',{z,db:async path=>path.startsWith('icash_deal_files')?[{terms:{},stage:'draft'}]:path.startsWith('icash_customer_identities')?[{principal:'SIMULATION'}]:(()=>{throw Error('No template/dispatch after live signing hold');})(),dealTermsSchema:{parse:()=>({state:'TN',legalDescription:'SIMULATION'})},signingReadiness:()=>{}});
 await assert.rejects(()=>signing.sendForSignatures({accountId:account,userId:user,customerEmail:'simulation@example.invalid',dealId:randomUUID(),kind:'purchase',signers:[]}),/Live work is not ready/);
 const response={json:(body,o={})=>({body,status:o.status??200})};
 const control=await loadService('app/api/work/control/route.ts',{NextResponse:response,z,allowedOrigin:()=>true,workAccount:async()=>({accountId:account,userId:user}),smsAccountReady:async()=>false,discoveryAccountReadiness:async()=>({ready:true}),db,stopDaily:async()=>{},fundingMode:()=> 'live'});
 assert.equal((await control.POST(new Request('https://example.invalid/api/work/control',{method:'POST',body:JSON.stringify({action:'resume'})}))).status,200);
 assert.equal((await one('select bot_paused from icash_accounts where id=$1',[account])).bot_paused,false);
 // Real reservation SQL, not a mocked affordability decision.
 for(const [sql,error] of [
  ['update icash_wallets set balance_cents=83 where account_id=$1',/Insufficient credits/],
  ['update icash_accounts set daily_limit_cents=83 where id=$1',/Daily budget/],
  ['update icash_spend_activations set customer_cap_cents=83 where account_id=$1',/Activation spending cap/],
 ]){await q('begin');try{await q(sql,[account]);await assert.rejects(()=>discovery.discoverForAccount(account),error);assert.equal(paid,0);}finally{await q('rollback');}}
 const reserve={accountId:account,operationKey:`discovery:${account}:${config.revision}:1`,rateId:rate,permissionUntil:config.data_rights_until,operation:'property_search'};
 await assert.rejects(()=>costs.reserveOperation({...reserve,rateId:ownerRate}),/Property discovery reservation/);
 await assert.rejects(()=>costs.reserveOperation({...reserve,operation:undefined}),/Live work is not ready/);
 await assert.rejects(()=>costs.reserveOperation({...reserve,operationKey:`owners:${account}:screen`}),/Property discovery reservation/);
 for(const [sql,value,status] of [
  ['update icash_discovery_configs set per_page=$2 where account_id=$1',6,'discovery_page_limit'],
  ['update icash_discovery_configs set data_rights_until=$2 where account_id=$1',new Date(Date.now()-1000).toISOString(),'not_ready'],
  ['update icash_discovery_configs set rate_id=$2 where account_id=$1',ownerRate,'rate_required'],
 ]){await q('begin');try{await q(sql,[account,value]);assert.equal((await discovery.discoverForAccount(account)).status,status);assert.equal(paid,0);}finally{await q('rollback');}}
 assert.equal((await discovery.discoverForAccount(randomUUID())).status,'not_ready');
 // An uncertain provider outcome consumes the operation once; retry cannot buy again.
 await q('begin');try{timeout=true;await assert.rejects(()=>discovery.discoverForAccount(account),/NO_RETRY/);assert.equal(paid,1);assert.equal((await discovery.discoverForAccount(account)).status,'awaiting_reconciliation');assert.equal(paid,1);assert.equal(Number((await one('select reserved_cents from icash_wallets where account_id=$1',[account])).reserved_cents),84);}finally{await q('rollback');timeout=false;paid=0;}
 // Real scheduler capability -> actual automation route -> real discovery/receipt -> real pure worker.
 const ticket=await rpc('icash_next_acquisition',{});assert(ticket?.token);
 const automation=await loadService('app/api/internal/automation/route.ts',{NextResponse:response,db,automationWorkReady,newLiveWorkKinds,deferUnstartedAutomation,discoverForAccount:discovery.discoverForAccount,readVoiceUsagePolicies:()=>[],settlePendingVoiceUsage:async()=>({}),reconcileLiveConversation:async()=>{},dispatchAttentionNotification:async()=>{}});
 const request=()=>new Request('https://example.invalid/api/internal/automation',{method:'POST',headers:{authorization:'Bearer '+ticket.token}});
 assert.equal((await automation.POST(request())).body.status,'screening_queued');assert.equal(paid,1);
 assert.equal((await automation.POST(request())).status,401);assert.equal(paid,1);
 for(let i=0;i<5;i++)assert.equal(await tick(rpc),true);
 const counts=await one("select count(*) n,count(*) filter(where state='complete' and result->'financialCheck'->>'status'='eligible') eligible from icash_screening_jobs where account_id=$1",[account]);assert.equal(Number(counts.n),5);assert.equal(Number(counts.eligible),5);
 const spend=await one('select state,charge_cap_cents from icash_operation_spend where account_id=$1',[account]);assert(['dispatched','settled'].includes(spend.state));assert.equal(Number(spend.charge_cap_cents),84);
 assert.equal(Number((await one('select count(*) n from icash_owner_contacts where account_id=$1',[account])).n),0);
 assert.equal(Number((await one('select count(*) n from icash_deal_files where account_id=$1',[account])).n),0);
 assert.equal((await discovery.discoverForAccount(account)).status,'not_ready');assert.equal(paid,1);
 console.log('SIMULATED PASS: $3-funded owner Run, real wallet/day/lifetime reservation rejects, five-property discovery via one-use scheduler/automation, genuine stored screening RPCs and worker, no contacts/deals/voice, wrong-kind/tenant/expiry/bounds and ambiguous receipt no-replay. No external requests.');
}finally{globalThis.fetch=oldFetch;await pg.close();}
