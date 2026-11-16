// Pure fictional transport fixtures only: never calls a real provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import {processDiscoveryOpenerRefresh} from '../lib/discovery-opener-refresh.ts';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const key='dm_sk_live_FICTIONAL';
const claim={id:id(1),requestId:id(2),quotaRequestId:id(3),kind:'dnc',request:{phones:[{number:'+12145550123'}]}};
function fixture(options={}){
 const calls=[];let saves=0;let claimed=false;let transports=0;
 const db=async(path,method,body)=>{
  calls.push({path,method,body});
  if(path.endsWith('resume_discovery_opener_refresh'))return {status:'awaiting_review'};
  if(path.endsWith('discovery_opener_refresh_receipt'))return null;
  if(path.endsWith('claim_discovery_opener_refresh')){if(claimed)return null;claimed=true;return options.claim??claim;}
  if(path.endsWith('record_discovery_opener_refresh')){saves++;if(options.lostAck&&saves===1)throw Error('local lost ack');return true;}
  if(path.endsWith('finish_dealmachine_request'))return true;
  throw Error('Unexpected RPC '+path);
 };
 const transport=async(url,init)=>{transports++;if(options.timeout)throw Error('timeout');return new Response(JSON.stringify(options.raw??{data:[{matched:true,do_not_call:false}]}),{status:options.status??200});};
 return {db,transport,calls,get transports(){return transports;}};
}
test('one new request; immutable receipt saved before processing and no send RPC',async()=>{
 const f=fixture();assert.equal((await processDiscoveryOpenerRefresh(f.db,key,id(1),f.transport)).status,'awaiting_review');
 assert.equal(f.transports,1);const saved=f.calls.findIndex(x=>x.path.endsWith('record_discovery_opener_refresh'));
 assert(saved>0);assert(f.calls.slice(saved+1).some(x=>x.path.endsWith('resume_discovery_opener_refresh')));
 assert(!f.calls.some(x=>/issue|dispatch|send_text|automation/.test(x.path)));
 await processDiscoveryOpenerRefresh(f.db,key,id(1),f.transport);assert.equal(f.transports,1);
});
test('unknown HTTP result never replays',async()=>{const f=fixture({timeout:true});assert.equal((await processDiscoveryOpenerRefresh(f.db,key,id(1),f.transport)).status,'renewal_requires_review');await processDiscoveryOpenerRefresh(f.db,key,id(1),f.transport);assert.equal(f.transports,1);assert(!f.calls.some(x=>x.path.endsWith('record_discovery_opener_refresh')));});
test('lost receipt acknowledgement retries identical database write only',async()=>{const f=fixture({lostAck:true});await processDiscoveryOpenerRefresh(f.db,key,id(1),f.transport);const saves=f.calls.filter(x=>x.path.endsWith('record_discovery_opener_refresh'));assert.equal(saves.length,2);assert.deepEqual(saves[0].body,saves[1].body);assert.equal(f.transports,1);});
test('HTTP error raw response retained without automatic provider retry',async()=>{const f=fixture({status:500,raw:{error:'fictional'}});await processDiscoveryOpenerRefresh(f.db,key,id(1),f.transport);const save=f.calls.find(x=>x.path.endsWith('record_discovery_opener_refresh'));assert.equal(save.body.p_status,500);assert.deepEqual(save.body.p_response,{error:'fictional'});assert.equal(f.transports,1);});
test('invalid provider config and changed claim never call provider',async()=>{let f=fixture();await processDiscoveryOpenerRefresh(f.db,undefined,id(1),f.transport);assert.equal(f.transports,0);f=fixture({claim:{...claim,id:id(9)}});await processDiscoveryOpenerRefresh(f.db,key,id(1),f.transport);assert.equal(f.transports,0);});
test('malformed saved property never becomes current research',async()=>{const f=fixture();const db=async(path,...args)=>path.endsWith('discovery_opener_refresh_receipt')?{id:id(2),renewalId:id(1),raw:{data:[]},requestedAt:new Date().toISOString(),assignmentFeeCents:1000000,sellerCostReserveCents:0}:f.db(path,...args);assert.equal((await processDiscoveryOpenerRefresh(db,key,id(1),f.transport)).status,'renewal_underwriting_review');assert.equal(f.transports,0);});
