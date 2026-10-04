import assert from 'node:assert/strict';
import {checkTelephonyConnection,saveTelephonyCheck} from '../scripts/check-telephony-connection.mjs';

let requests=[];
const fetcher=async(url,init)=>{requests.push({url,method:init.method??'GET'});return new Response('secret-provider-payload',{status:403});};
const env={ELEVENLABS_API_KEY:'private-test-key-do-not-log',TWILIO_ACCOUNT_SID:'AC'+'1'.repeat(32),TWILIO_AUTH_TOKEN:'private-test-token-do-not-log',CONTIGUITY_API_KEY:'private-test-key-do-not-log',CONTIGUITY_FROM:'+14243948384'};
const report=await checkTelephonyConnection(env,fetcher);
assert(requests.length>0);
assert(requests.every(r=>r.method==='GET'));
assert.equal(report.forwarding.routeConfigured,false);
assert.equal(report.incoming.status,'unavailable');
assert.equal(report.outgoing.providerChecksPass,false);
assert.equal(report.liveCallVerification,'not_tested');
assert(!JSON.stringify(report).includes('private-test'));
assert(!JSON.stringify(report).includes('secret-provider-payload'));
assert.equal(await saveTelephonyCheck(report,{},fetcher),false);
assert.equal(report.callsPlaced,0);
assert.equal(report.messagesSent,0);
console.log('PASS: telephony diagnostics are read-only and fail closed without leaking credentials or provider bodies.');
