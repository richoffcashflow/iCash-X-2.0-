process.env.ICASH_LIVE_WORK_READY='true'; // Ready-state provider fixtures only.
import assert from 'node:assert/strict';
import {evaluateLaunch} from '../lib/launch-readiness-policy.ts';
import {reviewedContractCoverage,contractCapability} from '../lib/contract-coverage.ts';
const now=Date.parse('2026-09-30T12:00:00Z');
const template=(kind,patch={})=>({state_code:'TX',kind,signer_count:1,enabled:true,test_mode:false,provider:'docuseal',reviewed_until:'2026-10-01T12:00:00Z',rate:{operation:'contract_signing',enabled:true,expires_at:'2026-10-01T12:00:00Z'},...patch});
const coverage=reviewedContractCoverage([template('purchase'),template('assignment'),template('purchase',{signer_count:2})],now);
assert(contractCapability(coverage,'TX',1).supported);for(const [state,count] of [['AL',1],['TN',1],['TX',2],[null,1]]){const c=contractCapability(coverage,state,count);assert(!c.supported);assert.match(c.reason,/Research only/);}
for(const patch of [{test_mode:true},{enabled:false},{reviewed_until:'2026-01-01'},{rate:null},{provider:'other'},{rate:{operation:'seller_call',enabled:true,expires_at:'2026-10-01'}}])assert(!contractCapability(reviewedContractCoverage([template('purchase'),template('assignment',patch)],now),'TX',1).supported);
console.log('Contract coverage: reviewed state + exact signer pair, expired/test/wrong-rate exclusions; no unsupported state is reported as contract-ready.');

const held=evaluateLaunch({cashReserve:true,discovery:true,voice:true,contactPermission:true,productionContracts:false,unresolvedDispatches:false},{data:true,voice:true,email:true,billing:true});assert.equal(held.ready,false);assert.equal(held.acquisitionReady,false);assert(held.blockers.includes('productionContracts'));
