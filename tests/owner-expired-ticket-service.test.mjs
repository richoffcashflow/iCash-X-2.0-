import assert from 'node:assert/strict';
import {continueExpiredOwnerPreflightTicket} from '../lib/owner-expired-preflight-ticket-continuation.ts';
for(const status of ['disabled','idle','busy','held'])assert.deepEqual(await continueExpiredOwnerPreflightTicket(async()=>({status})),{status});
const valid={status:'continued',ticketId:'00000000-0000-4000-8000-000000000001',preflightId:'00000000-0000-4000-8000-000000000002'};
assert.deepEqual(await continueExpiredOwnerPreflightTicket(async()=>valid),valid);
for(const result of [null,{},false,{status:'complete'},{status:'continued'},{...valid,ticketId:'wrong'},{...valid,preflightId:0}]){
 let calls=0;await assert.rejects(continueExpiredOwnerPreflightTicket(async(path,method,body)=>{
  calls++;assert.equal(path,'rpc/icash_continue_expired_owner_preflight_ticket');assert.equal(method,'POST');assert.deepEqual(body,{});return result;
 }),/UNAVAILABLE/);assert.equal(calls,1,'An unknown acknowledgment never repeats the recovery');
}
console.log('PASS original-ticket continuation acknowledgment validation without retry or provider work.');
