import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {discoveryWorkEnabled,contactWorkEnabled,liveWorkReady} from '../lib/live-work-admission.ts';
import {fullCostReserve,costCategories} from '../lib/cost-guard.ts';
import {workspaceStatus,workspaceNextAction} from '../lib/workspace-status.ts';
import {discoveryBlockerMessage} from '../lib/discovery-blocker-message.ts';
import {discoverPage} from '../lib/discovery-pipeline.ts';
Object.assign(process.env,{ICASH_LIVE_WORK_READY:'false',ICASH_DISCOVERY_WORK_READY:'true',DEALMACHINE_API_KEY:'dm_sk_live_SIMULATION_NO_NETWORK'});
const future=new Date(Date.now()+86400000).toISOString(),past=new Date(Date.now()-60000).toISOString();
const config={enabled:true,auto_enabled:true,exhausted:false,zip:'38118',rate_id:'rate',per_page:5,property_credit_micros:10000,data_rights_until:future};
const rows={icash_discovery_configs:[],icash_accounts:[{owner_user_id:'owner',daily_limit_cents:0,bot_paused:true}],icash_wallets:[{balance_cents:1000,reserved_cents:0}],icash_operating_budget:[{enabled:true,require_company_reserve:false,standard_cost_multiplier:5}],icash_spend_activations:[],icash_funding_orders:[{id:'confirmed-paid-fixture'}],icash_operation_spend:[],icash_credit_ledger:[],icash_operation_rates:[{enabled:true,operation:'property_search',version:'planning',charge_cents:84,costs_micros:{...Object.fromEntries(costCategories.map(k=>[k,0])),dealmachine:100000,other:40000},buffer_bps:2000,verified_at:past,expires_at:future}]};
let calls=0;
const db=async(path,method='GET')=>{calls++;assert.equal(method,'GET','readiness must not write, provision, purchase or unpause');return structuredClone(rows[path.split('?')[0]]??[]);};
const service=await loadService('lib/discovery-channel-readiness.ts',{db,discoveryWorkEnabled,contactWorkEnabled,liveWorkReady,fullCostReserve,propertyResearchMarketKnown:async()=>true,acquisitionContractCoverage:async()=>({supported:false})});
const read=()=>service.discoveryAccountReadiness('account','owner');
assert.equal((await read()).reason,'discovery_configuration_required');
// Fixtures model separately authorized provisioning and budget inputs, not actions by readiness.
rows.icash_discovery_configs=[config];
assert.equal((await read()).reason,'spending_activation_required');
const presentation={identity:{},paused:true,workReady:false,discoveryWorkReady:false,discoveryBlocker:(await read()).reason,balanceCents:1000};
assert.match(workspaceStatus(presentation).detail,/do not pay again/);
assert.equal(workspaceNextAction(presentation,null).kind,'support');
assert.equal(workspaceNextAction({...presentation,discoveryBlocker:'discovery_not_released'},{configured:false,released:false,liveWorkReady:false,smsChannelEnabled:true,policy:{version:'v'},acknowledgment:null}).label,'Choose outreach channels');
rows.icash_spend_activations=[{enabled:true,customer_cap_cents:300}];
const ready=await read();assert.equal(ready.ready,true);assert.equal(rows.icash_accounts[0].bot_paused,true);
assert.equal(workspaceNextAction({...presentation,discoveryWorkReady:true,discoveryQuote:ready.quote},null).label,'Start discovery');
assert.equal(workspaceStatus({...presentation,discoveryWorkReady:true}).label,'PAUSED');
assert.equal((await service.discoveryAccountReadiness('account','different-owner')).reason,'readiness_unavailable');
for(const [table,key,value,reason] of [
 ['icash_discovery_configs','auto_enabled',false,'discovery_not_enabled'],
 ['icash_discovery_configs','data_rights_until',past,'data_review_required'],
 ['icash_discovery_configs','exhausted',true,'inventory_exhausted'],
 ['icash_operation_rates','enabled',false,'pricing_review_required'],
 ['icash_wallets','balance_cents',80,'available_credits_required'],
 ['icash_spend_activations','enabled',false,'spending_activation_required'],
 ['icash_operating_budget','enabled',false,'operating_budget_unavailable'],
]){const before=rows[table][0][key];rows[table][0][key]=value;assert.equal((await read()).reason,reason);rows[table][0][key]=before;}
rows.icash_spend_activations[0].customer_cap_cents=1;
rows.icash_accounts[0].daily_limit_cents=0;
rows.icash_operation_spend=Array.from({length:1001},()=>({state:'settled',charged_cents:100}));
rows.icash_credit_ledger=Array.from({length:1001},()=>({delta_cents:-100}));
assert.equal((await read()).ready,true,'funded users are not blocked by lifetime, daily, or history-size limits');
assert(calls>0);assert.equal(discoveryBlockerMessage('constructor'),null);assert.equal(discoveryBlockerMessage('arbitrary database error'),null);
assert.equal(workspaceNextAction({...presentation,discoveryBlocker:'available_credits_required'},null).kind,'funding');
assert.match(discoveryBlockerMessage('confirmed_funding_required').detail,/before paying again/);
assert.equal(workspaceStatus({...presentation,billingReview:true}).label,'PAYMENT REVIEW');
assert.equal(workspaceNextAction({...presentation,activeWork:true,paused:false},null).kind,'pause');
// The actual property pipeline is exercised with network-free provider fixtures.
let reserved=false,persisted;
const result=await discoverPage({zip:'38118',page:1,perPage:5,unitCostMicros:10000,quotedDataCostMicros:100000},{reserveAndClaim:async()=>{reserved=true;return true;},request:async body=>{assert.equal(body.contact_audience,'none');if(body.estimate_cost)return {estimated_credits:{this_page:1,breakdown:{people:0}}};assert(reserved);return {data:[{dm_property_id:'prop_12345',full_address:'Fixture property address'}],credits:{used:1,people:0},pagination:{has_next_page:false}};},persist:async value=>{persisted=value;}});
assert.equal(result.status,'screening_queued');assert.equal(persisted.rows[0].dm_property_id,'prop_12345');
const setup=readFileSync(new URL('../app/api/setup/route.ts',import.meta.url),'utf8');assert.doesNotMatch(setup,/discoverForAccount|icash_reserve_operation|icash_set_work_control/);
const account=readFileSync(new URL('../app/api/account/route.ts',import.meta.url),'utf8');assert.match(account,/discoveryBlocker:discovery.ready\?null/);
const activity=readFileSync(new URL('../app/api/work/activity/route.ts',import.meta.url),'utf8');assert.match(activity,/account_id=eq\.\$\{accountId\}.*state=eq.complete/);
const workspace=readFileSync(new URL('../components/live-workspace.tsx',import.meta.url),'utf8');assert.match(workspace,/Practice only · no real property/);assert.match(workspace,/\[true,'true'\]\.includes/);
console.log('PASS network-free newcomer readiness fixtures: provisioning/activation/budget blockers, explicit Start preserved, no mutation or fabricated consent, reserved provider records queued for screening, scoped workspace and practice labeling. This is not live onboarding E2E.');
