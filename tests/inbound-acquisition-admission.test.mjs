import assert from 'node:assert/strict';
import {discoveryWorkEnabled,contactWorkEnabled,automationWorkReady,smsWorkEnabled} from '../lib/live-work-admission.ts';

const env={ICASH_ACQUISITION_MODE:'inbound',ICASH_LIVE_WORK_READY:'true',ICASH_DISCOVERY_WORK_READY:'true',ICASH_CONTACT_WORK_READY:'true',ICASH_SMS_WORK_READY:'true'};
assert.equal(discoveryWorkEnabled(env),false);
assert.equal(contactWorkEnabled(env),false);
assert.equal(automationWorkReady('discovery',env),false);
assert.equal(automationWorkReady('contacts',env),false);
for(const kind of ['seller_opener','text_ai','voice_dispatch','fulfillment','voice_result','signing_result']) assert.equal(automationWorkReady(kind,env),true,kind);
assert.equal(smsWorkEnabled(env),true);
assert.equal(automationWorkReady('voice_dispatch',{...env,ICASH_LIVE_WORK_READY:'false'}),false);
assert.equal(discoveryWorkEnabled({...env,ICASH_ACQUISITION_MODE:'outbound'}),true);
console.log('PASS inbound acquisition blocks property discovery and prospect enrichment even with full live-work flags, preserving inbound follow-up and contract-gated fulfillment.');
