process.env.ICASH_LIVE_WORK_READY='true'; // Ready-state provider fixtures only.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {discoveryWorkEnabled,liveWorkReady} from '../lib/live-work-admission.ts';
import {evaluateLaunch} from '../lib/launch-readiness-policy.ts';
import {reviewedContractCoverage,contractCapability} from '../lib/contract-coverage.ts';
const now=Date.parse('2026-09-30T12:00:00Z');
const template=(kind,patch={})=>({state_code:'TX',kind,signer_count:1,enabled:true,test_mode:false,provider:'docuseal',reviewed_until:'2026-10-01T12:00:00Z',rate:{operation:'contract_signing',enabled:true,expires_at:'2026-10-01T12:00:00Z'},...patch});
const coverage=reviewedContractCoverage([template('purchase'),template('assignment'),template('purchase',{signer_count:2})],now);
assert(contractCapability(coverage,'TX',1).supported);for(const [state,count] of [['AL',1],['TN',1],['TX',2],[null,1]]){const c=contractCapability(coverage,state,count);assert(!c.supported);assert.match(c.reason,/Research only/);}
for(const patch of [{test_mode:true},{enabled:false},{reviewed_until:'2026-01-01'},{rate:null},{provider:'other'},{rate:{operation:'seller_call',enabled:true,expires_at:'2026-10-01'}}])assert(!contractCapability(reviewedContractCoverage([template('purchase'),template('assignment',patch)],now),'TX',1).supported);
// Actual acquisition service must stop before budget reservation or provider access in uncovered markets.
let calls=[];
const mocks={discoveryWorkEnabled,liveWorkReady,acquisitionContractCoverage:async()=>({supported:false,reason:'Research only: TN templates unavailable.'}),db:async(path)=>{calls.push(path);if(path.startsWith('icash_discovery_configs'))return [{enabled:true,exhausted:false,zip:'38118',data_rights_until:'2099-01-01'}];throw Error('Unexpected downstream call');},dispatchReservedOperation:async()=>{throw Error('Must not reserve funds');},discoverPage:async()=>{throw Error('Must not call provider');}};
globalThis.__coverage=mocks;
let source=ts.transpileModule(readFileSync(new URL('../lib/discovery-service.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');source='const {'+Object.keys(mocks).join(',')+'}=globalThis.__coverage;\n'+source;
const {discoverForAccount}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));const result=await discoverForAccount('fixture');assert.equal(result.status,'contract_coverage_required');assert.equal(calls.length,1);delete globalThis.__coverage;
console.log('Contract coverage: reviewed state + exact signer pair, expired/test/wrong-rate exclusions, unsupported acquisition stops before spend/provider call.');

const held=evaluateLaunch({cashReserve:true,discovery:true,voice:true,contactPermission:true,productionContracts:false,unresolvedDispatches:false},{data:true,voice:true,email:true,billing:true});assert.equal(held.ready,false);assert.equal(held.acquisitionReady,false);assert(held.blockers.includes('productionContracts'));
