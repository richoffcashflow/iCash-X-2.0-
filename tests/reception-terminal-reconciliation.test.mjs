import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reconcileReceptionTerminals} from '../lib/reception-terminal-reconciliation.ts';
import {legacyReceptionTargets} from '../lib/legacy-reception-cost-observation.ts';
import {receptionTarget} from '../lib/general-reception.ts';
import {ownerInboundTarget} from '../lib/owner-inbound-acceptance.ts';
const env={TWILIO_ACCOUNT_SID:'AC'+'a'.repeat(32),TWILIO_AUTH_TOKEN:'synthetic-only-token',ELEVENLABS_API_KEY:'synthetic-only-key'};
function fixture(change=()=>{}){
 const writes=[];
 const fetcher=async(url,init)=>{
  assert.equal(init.method,'GET');assert.equal(init.redirect,'error');
  const t=legacyReceptionTargets.find(x=>url.includes(x.callSid)||url.includes(x.conversationId));assert(t);
  let value=url.includes('twilio.com')?{sid:t.callSid,account_sid:env.TWILIO_ACCOUNT_SID,to:receptionTarget.calledNumber,from:ownerInboundTarget.ownerPhone,direction:'inbound',status:'completed',duration:'31',price:null,price_unit:'USD'}:{conversation_id:t.conversationId,agent_id:receptionTarget.agentId,branch_id:'agtbrch_fixture',version_id:'agtvrsn_fixture',status:'done',user_id:'icash-reception:'+'b'.repeat(64),conversation_initiation_client_data:{dynamic_variables:{icash_reception_receipt_nonce:'b'.repeat(64),icash_reception_call_sid:t.callSid}},metadata:{call_duration_secs:30,cost_fiat:.011075}};
  change(value,url);return Response.json(value);
 };
 return {writes,run:()=>reconcileReceptionTerminals(env,async(name,body)=>{writes.push({name,body});return true;},fetcher)};
}
test('missing carrier prices do not erase terminal evidence or settle money',async()=>{
 const f=fixture();assert.deepEqual(await f.run(),{verified:2,total:2,billingUnchanged:true});assert.equal(f.writes.length,2);
 for(const w of f.writes){assert.equal(w.name,'icash_attest_reception_terminal');assert.equal(w.body.p_evidence.terminal,true);assert.equal(w.body.p_evidence.twilioMicros,null);assert.equal(w.body.p_evidence.settled,false);assert(!JSON.stringify(w).includes(env.TWILIO_AUTH_TOKEN));}
});
for(const change of [v=>{if(v.sid)v.status='in-progress';},v=>{if(v.sid)v.to='+12125550111';},v=>{if(v.sid)v.account_sid='AC'+'c'.repeat(32);},v=>{if(v.conversation_id)v.status='processing';},v=>{if(v.conversation_id)v.conversation_initiation_client_data.dynamic_variables.icash_reception_call_sid='CA'+'e'.repeat(32);}])test('unknown or mismatched provider evidence cannot authorize migration',async()=>{const f=fixture(change);assert.equal((await f.run()).verified,0);assert.equal(f.writes.length,0);});
