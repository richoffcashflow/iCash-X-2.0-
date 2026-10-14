import assert from 'node:assert/strict';
import {z} from 'zod';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {buyerNetworkDealQuery} from '../lib/buyer-network-workspace.ts';
import {networkError} from '../lib/buyer-network.ts';

const accountId='00000000-0000-4000-8000-000000000001',dealId='00000000-0000-4000-8000-000000000002';
let signedIn=true,vip=true,owned=true,active=true;const calls=[];
const {GET}=await loadService('app/api/work/buyer-network/route.ts',{
 z,networkError,buyerNetworkDealQuery,NextResponse:{json:(data,init)=>Response.json(data,init)},
 workAccount:async()=>{if(!signedIn)throw Error('SIGN_IN_REQUIRED');return {accountId};},
 db:async(path,method,body)=>{
  calls.push(path);
  if(path==='rpc/icash_vip_features_active'){assert.deepEqual(body,{p_account:accountId});return vip;}
  if(path==='rpc/icash_network_workspace'){assert.equal(body.p_account,accountId);return {vip:true,responses:0,buyers:[]};}
  const params=new URLSearchParams(path.split('?')[1]);assert.equal(params.get('account_id'),`eq.${accountId}`);
  if(params.get('select')==='id')return owned?[{id:dealId}]:[];
  assert.match(params.get('select'),/icash_signing_envelopes!inner\(\)/);
  assert.match(params.get('select'),/icash_screening_jobs!inner\(\)/);
  assert.equal(params.get('icash_signing_envelopes.account_id'),`eq.${accountId}`);
  assert.equal(params.get('icash_signing_envelopes.state'),'eq.completed');
  assert.equal(params.get('icash_signing_envelopes.kind'),'eq.purchase');
  assert.equal(params.get('icash_signing_envelopes.test_mode'),'eq.false');
  assert.equal(params.get('icash_screening_jobs.account_id'),`eq.${accountId}`);
  assert.equal(params.get('icash_screening_jobs.state'),'eq.complete');
  assert.equal(params.get('limit'),'1');assert.equal(params.has('offset'),false);
  assert.equal(params.get('stage'),'not.in.(closed,canceled,cancelled,cancellation_pending)');
  return active?[{id:dealId}]:[];
 }
});
const request=(query='')=>GET(new Request('https://example.test/api/work/buyer-network'+query));
for(const hasDeal of [false,true]){active=hasDeal;const response=await request('?page=100&query=no-match');assert.equal(response.status,200);assert.equal((await response.json()).hasActiveDeal,hasDeal);assert.match(response.headers.get('cache-control'),/private, no-store/);}
owned=false;calls.length=0;assert.equal((await request('?dealId='+dealId)).status,404);assert(!calls.includes('rpc/icash_network_workspace'));
vip=false;calls.length=0;assert.equal((await request()).status,403);assert.deepEqual(calls,['rpc/icash_vip_features_active']);
signedIn=false;calls.length=0;assert.equal((await request()).status,401);assert.deepEqual(calls,[]);
console.log('PASS buyer network: signed active deal scope, archived/test/stopped exclusions, account-wide pagination independence and VIP/ownership boundaries.');
