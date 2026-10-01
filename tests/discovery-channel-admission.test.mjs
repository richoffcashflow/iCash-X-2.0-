import assert from 'node:assert/strict';
import {z} from 'zod';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {discoveryWorkEnabled,liveWorkReady,smsWorkEnabled,automationWorkReady,newLiveWorkKinds,deferUnstartedAutomation} from '../lib/live-work-admission.ts';
import {fullCostReserve,costCategories} from '../lib/cost-guard.ts';
import {workspaceNextAction,workspaceStatus} from '../lib/workspace-status.ts';
assert.equal(discoveryWorkEnabled({}),false);assert.equal(discoveryWorkEnabled({ICASH_DISCOVERY_WORK_READY:'TRUE'}),false);
const env={ICASH_LIVE_WORK_READY:'false',ICASH_DISCOVERY_WORK_READY:'true'};
for(const kind of newLiveWorkKinds)assert.equal(automationWorkReady(kind,env),kind==='discovery',kind);
Object.assign(process.env,env,{DEALMACHINE_API_KEY:'dm_sk_live_SIMULATION_NO_NETWORK',ICASH_SMS_WORK_READY:'false'});
const future=new Date(Date.now()+86400000).toISOString(),past=new Date(Date.now()-60000).toISOString();
const rows={
 icash_discovery_configs:[{enabled:true,auto_enabled:true,exhausted:false,zip:'38118',rate_id:'rate',per_page:5,property_credit_micros:10000,data_rights_until:future,revision:'revision',next_page:1}],
 icash_accounts:[{owner_user_id:'owner',daily_limit_cents:300}],icash_wallets:[{balance_cents:300,reserved_cents:0}],
 icash_operating_budget:[{enabled:true,require_company_reserve:false,standard_cost_multiplier:5}],icash_spend_activations:[{enabled:true,customer_cap_cents:300}],
 icash_funding_orders:[{id:'paid'}],icash_operation_spend:[],icash_credit_ledger:[],
 icash_operation_rates:[{enabled:true,operation:'property_search',version:'planning',charge_cents:84,costs_micros:{...Object.fromEntries(costCategories.map(k=>[k,0])),dealmachine:100000,other:40000},buffer_bps:2000,verified_at:past,expires_at:future}],
};
let writes=0,covered=true;const db=async(path,method='GET')=>{assert.equal(method,'GET','readiness must be read-only');return structuredClone(rows[path.split('?')[0]]??[]);};
const readiness=await loadService('lib/discovery-channel-readiness.ts',{db,discoveryWorkEnabled,fullCostReserve,acquisitionContractCoverage:async()=>({supported:covered})});
const ready=await readiness.discoveryAccountReadiness('account','owner');assert.equal(ready.ready,true);assert.deepEqual(ready.quote,{chargeCents:84,maxProperties:5,costBasis:'planning_estimate'});
assert.equal((await readiness.discoveryAccountReadiness('account','wrong-owner')).ready,false);
for(const [table,key,value] of [
 ['icash_discovery_configs','enabled',false],['icash_discovery_configs','auto_enabled',false],['icash_discovery_configs','per_page',6],['icash_discovery_configs','data_rights_until','invalid'],['icash_discovery_configs','data_rights_until',past],
 ['icash_operation_rates','expires_at',past],['icash_operation_rates','verified_at',future],['icash_operation_rates','operation','owner_enrichment'],['icash_operation_rates','charge_cents',1],
 ['icash_wallets','balance_cents',83],['icash_wallets','reserved_cents',217],['icash_accounts','daily_limit_cents',83],['icash_spend_activations','customer_cap_cents',83],['icash_spend_activations','enabled',false],['icash_operating_budget','enabled',false],
 ]){const old=rows[table][0][key];rows[table][0][key]=value;assert.equal((await readiness.discoveryAccountReadiness('account','owner')).ready,false,`${table}.${key}`);rows[table][0][key]=old;}
rows.icash_credit_ledger=[{delta_cents:-217}];assert.equal((await readiness.discoveryAccountReadiness('account','owner')).ready,false);rows.icash_credit_ledger=[];
rows.icash_operation_spend=[{state:'settled',charged_cents:217}];assert.equal((await readiness.discoveryAccountReadiness('account','owner')).ready,false);rows.icash_operation_spend=[];
covered=false;assert.equal((await readiness.discoveryAccountReadiness('account','owner')).ready,false);covered=true;
const response={json:(body,o={})=>({body,status:o.status??200})};
const control=await loadService('app/api/work/control/route.ts',{NextResponse:response,z,allowedOrigin:()=>true,workAccount:async()=>({accountId:'account',userId:'owner'}),smsAccountReady:async()=>false,discoveryAccountReadiness:readiness.discoveryAccountReadiness,db:async(path,_method,body)=>{writes++;assert.equal(path,'rpc/icash_set_work_control');assert.deepEqual(body,{p_user:'owner',p_account:'account',p_action:'resume',p_screening:null});},stopDaily:async()=>{},fundingMode:()=> 'live'});
const request=action=>new Request('https://example.invalid/api/work/control',{method:'POST',body:JSON.stringify({action})});
assert.equal((await control.POST(request('resume'))).status,200);assert.equal(writes,1);
assert.equal((await control.POST(request('return_to_bot'))).status,503);assert.equal(writes,1);
rows.icash_wallets[0].balance_cents=83;assert.equal((await control.POST(request('resume'))).status,503);assert.equal(writes,1);rows.icash_wallets[0].balance_cents=300;
const a={identity:{},paused:true,balanceCents:300,workReady:false,smsWorkReady:false,discoveryWorkReady:true,discoveryQuote:ready.quote};
assert.equal(workspaceNextAction(a,null).label,'Start discovery');assert.match(workspaceNextAction(a,null).reason,/5 properties.*\$0.84 planning/);
const campaign={configured:true,released:false,liveWorkReady:false,smsChannelEnabled:true,policy:{version:'v'},acknowledgment:{version:'v'}};
assert.equal(workspaceNextAction(a,campaign).label,'Start discovery');assert.match(workspaceNextAction(a,campaign).reason,/outreach.*held/);
assert.equal(workspaceStatus({...a,paused:false}).label,'DISCOVERY READY');
assert.equal(workspaceNextAction({...a,smsWorkReady:true},{...campaign,released:true}).label,'Start discovery & SMS');
// The actual route admits only discovery and retains existing receipt/settlement paths.
let kind='discovery',dispatches=0;const token='00000000-0000-0000-0000-000000000000'.repeat(2);
const automation=await loadService('app/api/internal/automation/route.ts',{automationWorkReady,newLiveWorkKinds,deferUnstartedAutomation:async()=>({status:'live_work_not_ready'}),NextResponse:response,db:async path=>path==='rpc/icash_consume_automation'?{id:'ticket',accountId:'account',kind,screeningId:'screen'}:[],discoverForAccount:async()=>{dispatches++;return {status:'screening_queued'};},readVoiceUsagePolicies:()=>[],settlePendingVoiceUsage:async()=>({}),reconcileLiveConversation:async()=>{},dispatchAttentionNotification:async()=>{}});
const automatic=()=>automation.POST(new Request('https://example.invalid/api/internal/automation',{method:'POST',headers:{authorization:'Bearer '+token}}));
assert.equal((await automatic()).body.status,'screening_queued');assert.equal(dispatches,1);
for(kind of newLiveWorkKinds){if(kind!=='discovery')assert.equal((await automatic()).body.status,'live_work_not_ready',kind);}assert.equal(dispatches,1);
for(const [file,fn] of Object.entries({'owner-enrichment-service':'enrichForAccount','live-dispatch-service':'dispatchLiveVoice','text-ai-service':'processTextAi','fulfillment-service':'prepareFulfillment','title-service':'dispatchTitleRequest'})){
 const service=await loadService('lib/'+file+'.ts',{z,db:async()=>{throw Error('Sibling work must stay held');}});assert.equal((await service[fn]('account','job')).status,'live_work_not_ready');
}
console.log('Property-only admission: actual readiness/Run/automation boundaries, scoped owner/quote/day/lifetime checks, five-record bound, unreleased campaign separation, and held sibling services passed.');
