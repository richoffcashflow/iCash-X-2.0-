import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {ownerQuickTestCallerRestriction as restriction} from '../lib/reception-setup.ts';
import {receptionTarget} from '../lib/general-reception.ts';
import {ownerInboundTarget} from '../lib/owner-inbound-acceptance.ts';
const env={TWILIO_AUTH_TOKEN:'synthetic_current_twilio_token_123456789'};
const expected=createHmac('sha256',env.TWILIO_AUTH_TOKEN).update('reception-caller-v1\0'+ownerInboundTarget.ownerPhone).digest('hex');
function fixture(change={}){
 const c={account_id:receptionTarget.accountId,owner_user_id:receptionTarget.ownerUserId,called_number:receptionTarget.calledNumber,enabled:false,...change.config};
 const s={schema_version:1,attempts:{},original_phone:null,route_started_at:null,...change.state};
 const calls=[];return {calls,deps:{fetcher:async()=>assert.fail('No provider dependency for caller restriction'),rpc:async(name,body)=>{calls.push(name);assert.equal(body,undefined);if(change.fail)throw Error('private error');if(name==='icash_get_general_reception_config')return c;if(name==='icash_get_reception_setup')return s;if(name==='icash_latest_general_reception_receipt')return Object.hasOwn(change,'receipt')?change.receipt:null;assert.fail('Unexpected mutation or RPC');}}};
}
const f=fixture();assert.equal(await restriction(env,f.deps),expected);assert.match(expected,/^[a-f0-9]{64}$/);assert.deepEqual(f.calls.sort(),['icash_get_general_reception_config','icash_get_reception_setup','icash_latest_general_reception_receipt']);
for(const change of [{config:{enabled:true}},{config:{enabled:null}},{config:{account_id:'other'}},{config:{owner_user_id:'other'}},{config:{called_number:'other'}},{state:{schema_version:2}},{state:{attempts:undefined}},{state:{attempts:null}},{state:{attempts:[]}},{state:{attempts:{prepare_branch:{state:'verified'}}}},{state:{original_phone:{}}},{state:{route_started_at:'2026-10-02T00:00:00Z'}},{receipt:{}},{receipt:[]},{receipt:undefined},{receipt:{receipt_id:'prior'}},{fail:true}])assert.equal(await restriction(env,fixture(change).deps),null);
for(const environment of [{},{TWILIO_AUTH_TOKEN:'short'},{TWILIO_AUTH_TOKEN:'unsafe\ntoken'.repeat(10)}]){const f=fixture();assert.equal(await restriction(environment,f.deps),null);assert.equal(f.calls.length,0);}
globalThis.window={};assert.equal(await restriction(env,fixture().deps),null);delete globalThis.window;
assert.notEqual(await restriction({TWILIO_AUTH_TOKEN:'different_current_twilio_token_123456789'},fixture().deps),expected);
console.log('Owner caller restriction: fixed target/current secret, disabled unused database only, no providers/mutations, fail-closed evidence, no phone/token output');
