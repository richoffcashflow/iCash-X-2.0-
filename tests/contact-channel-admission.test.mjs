import assert from 'node:assert/strict';
import {z} from 'zod';
import {loadService} from './helpers/simulated-journey-services.mjs';
import * as admission from '../lib/live-work-admission.ts';
import {fullCostReserve,costCategories} from '../lib/cost-guard.ts';
import {runScreeningJob} from '../lib/screening-job.ts';
import {workspaceNextAction,workspaceStatus} from '../lib/workspace-status.ts';
const {contactWorkEnabled,automationWorkReady,newLiveWorkKinds}=admission;
assert.equal(contactWorkEnabled({}),false);assert.equal(contactWorkEnabled({ICASH_CONTACT_WORK_READY:'TRUE'}),false);
const env={ICASH_LIVE_WORK_READY:'false',ICASH_DISCOVERY_WORK_READY:'false',ICASH_SMS_WORK_READY:'false',ICASH_CONTACT_WORK_READY:'true'};
for(const kind of newLiveWorkKinds)assert.equal(automationWorkReady(kind,env),kind==='contacts',kind);
Object.assign(process.env,env,{DEALMACHINE_API_KEY:'dm_sk_live_SIMULATION_NO_NETWORK'});
const screen='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',future=new Date(Date.now()+86400000).toISOString(),past=new Date(Date.now()-60000).toISOString();
const snapshot={propertyId:'prop_123',propertyType:'house',fetchedAt:new Date().toISOString(),sellerCostReserveCents:0,raw:{data:{dm_property_id:'prop_123',full_address:'SIMULATION',estimated_value:200000,estimated_repair_cost:40000,total_estimated_loan_balance:50000}}};
const rows={
 icash_discovery_configs:[{enabled:true,auto_enabled:true,exhausted:true,contacts_enabled:true,contact_rate_id:'rate',contact_credit_cap:25,property_credit_micros:10000,data_rights_until:future}],
 icash_accounts:[{owner_user_id:'owner',daily_limit_cents:300}],icash_wallets:[{balance_cents:230,reserved_cents:0}],
 icash_operating_budget:[{enabled:true,require_company_reserve:false,standard_cost_multiplier:5}],icash_spend_activations:[{enabled:true,customer_cap_cents:244}],
 icash_funding_orders:[{id:'paid'}],icash_operation_spend:[{state:'settled',charged_cents:70}],icash_credit_ledger:[{delta_cents:-70}],
 icash_screening_jobs:[{state:'complete',snapshot}],
 icash_operation_rates:[{enabled:true,operation:'owner_enrichment',version:'planning',charge_cents:174,costs_micros:{...Object.fromEntries(costCategories.map(k=>[k,0])),dealmachine:250000,other:40000},buffer_bps:2000,verified_at:past,expires_at:future}],
};
let candidate=screen,prior=false,reads=0;
const db=async(path,method='GET',body)=>{reads++;
 if(path==='rpc/icash_enrichment_candidate'){assert.equal(method,'POST');assert.deepEqual(body,{p_account:'account'});return candidate;}
 assert.equal(method,'GET','no readiness mutations');
 if(path.startsWith('icash_operation_spend?operation_key='))return prior?[{state:'dispatched'}]:[];
 return structuredClone(rows[path.split('?')[0]]??[]);
};
const readyModule=await loadService('lib/discovery-channel-readiness.ts',{db,...admission,fullCostReserve,runScreeningJob,acquisitionContractCoverage:async()=>{throw Error('No contract dependency for contacts');},propertyResearchMarketKnown:async()=>{throw Error('No new market assignment');}});
const ready=()=>readyModule.contactAccountReadiness('account','owner');
assert.equal((await ready()).ready,true);assert.deepEqual((await ready()).quote,{chargeCents:174,maxContacts:25,costBasis:'planning_estimate'});
assert.equal((await readyModule.contactAccountReadiness('account','other')).ready,false);
for(const [table,key,value] of [
 ['icash_discovery_configs','enabled',false],['icash_discovery_configs','auto_enabled',false],['icash_discovery_configs','contacts_enabled',false],['icash_discovery_configs','contact_credit_cap',26],['icash_discovery_configs','data_rights_until','bad'],
 ['icash_operation_rates','operation','property_search'],['icash_operation_rates','expires_at',past],['icash_operation_rates','verified_at',future],['icash_operation_rates','charge_cents',1],
 ['icash_wallets','balance_cents',173],['icash_accounts','daily_limit_cents',243],['icash_spend_activations','customer_cap_cents',243],['icash_operating_budget','enabled',false],
 ]){const old=rows[table][0][key];rows[table][0][key]=value;assert.equal((await ready()).ready,false,`${table}.${key}`);rows[table][0][key]=old;}
candidate=null;assert.equal((await ready()).ready,false);candidate=screen;prior=true;assert.equal((await ready()).ready,false);prior=false;
rows.icash_screening_jobs[0].snapshot={...snapshot,fetchedAt:new Date(Date.now()-25*3600000).toISOString()};assert.equal((await ready()).ready,false);rows.icash_screening_jobs[0].snapshot=snapshot;
const old=rows.icash_screening_jobs[0].snapshot.raw.data.total_estimated_loan_balance;rows.icash_screening_jobs[0].snapshot.raw.data.total_estimated_loan_balance=190000;assert.equal((await ready()).ready,false);rows.icash_screening_jobs[0].snapshot.raw.data.total_estimated_loan_balance=old;
let writes=0;const response={json:(body,o={})=>({body,status:o.status??200})};
const control=await loadService('app/api/work/control/route.ts',{NextResponse:response,z,allowedOrigin:()=>true,workAccount:async()=>({accountId:'account',userId:'owner'}),smsAccountReady:async()=>false,discoveryAccountReadiness:async()=>({ready:false}),contactAccountReadiness:readyModule.contactAccountReadiness,db:async(path,_method,body)=>{writes++;assert.equal(path,'rpc/icash_set_work_control');assert.deepEqual(body,{p_user:'owner',p_account:'account',p_action:'resume',p_screening:null});},stopDaily:async()=>{},fundingMode:()=> 'live'});
const req=action=>new Request('https://example.invalid/api/work/control',{method:'POST',body:JSON.stringify({action})});
assert.equal((await control.POST(req('resume'))).status,200);assert.equal(writes,1);assert.equal((await control.POST(req('return_to_bot'))).status,503);assert.equal(writes,1);
rows.icash_discovery_configs[0].auto_enabled=false;assert.equal((await control.POST(req('resume'))).status,503);assert.equal(writes,1);rows.icash_discovery_configs[0].auto_enabled=true;
const a={identity:{},paused:true,balanceCents:230,workReady:false,smsWorkReady:false,discoveryWorkReady:false,contactWorkReady:true,contactQuote:(await ready()).quote};
assert.equal(workspaceNextAction(a,null).label,'Start contact lookup');assert.match(workspaceNextAction(a,null).reason,/25.*\$1.74.*limits/);assert.match(workspaceNextAction(a,null).reason,/do not authorize outreach/);assert.equal(workspaceStatus({...a,paused:false}).label,'CONTACT LOOKUP READY');
const releasedCampaign={configured:true,released:true,liveWorkReady:false,smsChannelEnabled:true,policy:{version:'current'},acknowledgment:{version:'current'}};
const mixed={...a,smsWorkReady:true};
assert.equal(workspaceNextAction(mixed,releasedCampaign).label,'Start contact lookup & SMS');
assert.match(workspaceNextAction(mixed,releasedCampaign).reason,/Eligible SMS can also run under the released campaign/);
for(const campaign of [null,{...releasedCampaign,released:false},{...releasedCampaign,configured:false},{...releasedCampaign,smsChannelEnabled:false},{...releasedCampaign,acknowledgment:null},{...releasedCampaign,acknowledgment:{version:'old'}}]){
 assert.equal(workspaceNextAction(mixed,campaign).label,'Start contact lookup');
 assert.doesNotMatch(workspaceNextAction(mixed,campaign).reason,/Eligible SMS can also run/);
}
assert.equal(workspaceNextAction(a,releasedCampaign).label,'Start contact lookup');
let kind='contacts',dispatches=0;const token='00000000-0000-0000-0000-000000000000'.repeat(2);
const automation=await loadService('app/api/internal/automation/route.ts',{...admission,deferUnstartedAutomation:async()=>({status:'live_work_not_ready'}),NextResponse:response,db:async path=>path==='rpc/icash_consume_automation'?{id:'ticket',accountId:'account',kind,screeningId:screen}:[],enrichForAccount:async(a,s)=>{assert.equal(a,'account');assert.equal(s,screen);dispatches++;return {status:'contacts_saved'};},readVoiceUsagePolicies:()=>[],settlePendingVoiceUsage:async()=>({}),reconcileLiveConversation:async()=>{}});
const automatic=()=>automation.POST(new Request('https://example.invalid/api/internal/automation',{method:'POST',headers:{authorization:'Bearer '+token}}));
assert.equal((await automatic()).body.status,'contacts_saved');assert.equal(dispatches,1);
for(kind of newLiveWorkKinds){if(kind!=='contacts')assert.equal((await automatic()).body.status,'live_work_not_ready',kind);}assert.equal(dispatches,1);
console.log('Contact-only admission: current eligible candidate, $1.74 quote/$2.44 lifetime/$3 daily boundaries, owner/rights/rates and prior-operation holds, existing Run and exact ticket scope, no outreach or one-shot-stop promise passed.');
