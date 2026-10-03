import assert from 'node:assert/strict';
import {ownerConsentDiagnostic,ownerRecoveryDiagnostic,ownerCarrierDiagnostic} from '../lib/owner-recording-diagnostics.ts';
import {affirmativeSpeech} from '../lib/required-call-recording.ts';
import {ownerConfidence} from '../lib/owner-recording-diagnostics.ts';

for(const [form,reason] of [
 [{SpeechResult:'yes'},'consent_not_verified'],
 [{SpeechResult:'yes',Confidence:''},'consent_confidence_malformed'],
 [{SpeechResult:'yes',Confidence:'NaN'},'consent_confidence_malformed'],
 [{SpeechResult:'yes',Confidence:'0x1'},'consent_confidence_malformed'],
 [{SpeechResult:'yes',Confidence:'0.8999999999999999999999'},'consent_not_verified'],
 [{SpeechResult:'yes',Confidence:'1.000000000000000000001'},'consent_confidence_malformed'],
 [{SpeechResult:'yes',Confidence:'1.2'},'consent_confidence_malformed'],
 [{SpeechResult:'yes',Confidence:'.89'},'consent_not_verified'],
 [{SpeechResult:'yes',Confidence:'.99',UnstableSpeechResult:'yes'},'consent_asr_unstable'],
 [{SpeechResult:'no yes',Confidence:'.99'},'consent_not_verified'],
 [{},'consent_not_verified'],
]){const params=new URLSearchParams(form);assert.equal(ownerConsentDiagnostic(params).reason,reason);const score=ownerConfidence(params.get('Confidence'));if(params.get('SpeechResult')==='yes'&&!params.has('UnstableSpeechResult')&&score.status!=='malformed')assert(affirmativeSpeech(params));else assert.equal(affirmativeSpeech(params),null);}
assert.equal(ownerConsentDiagnostic(new URLSearchParams({SpeechResult:'Yes!',Confidence:'.99'})).speechStatus,'exact_affirmative');
assert.equal(ownerConsentDiagnostic(new URLSearchParams({SpeechResult:'yes',Confidence:'.5'})).confidenceReported,'.5');
assert.equal(ownerConsentDiagnostic(new URLSearchParams({SpeechResult:'yes',Confidence:'0.8999999999999999999999'})).confidenceReported,'0.8999999999999999999999');
assert.equal(ownerConsentDiagnostic(new URLSearchParams({SpeechResult:'yes',Confidence:'private-token'})).confidenceReported,null);
assert.equal(affirmativeSpeech(new URLSearchParams({SpeechResult:'Yes!',Confidence:'.99'})).confidence,.99);
const privateForm=new URLSearchParams({SpeechResult:'private phrase +12125550000',Confidence:'private-token',From:'+12125550000',nonce:'private-token'});
const serialized=JSON.stringify(ownerConsentDiagnostic(privateForm));for(const raw of ['private phrase','+12125550000','private-token','SpeechResult','From','nonce'])assert(!serialized.includes(raw));
assert.equal(ownerRecoveryDiagnostic(Error('OWNER_CARRIER_PRICE_PENDING')),'OWNER_CARRIER_PRICE_PENDING');
assert.equal(ownerRecoveryDiagnostic(Error('secret=private-token')),'OWNER_RECORDING_RECONCILIATION_REQUIRED');
const carrier=ownerCarrierDiagnostic({price:null,duration:23,from:'+12125550000',authorization:'private-token'},true,true);assert.equal(carrier.pricePresent,false);assert.equal(carrier.durationValid,false);assert.equal(carrier.durationType,'number');assert(!JSON.stringify(carrier).includes('+12125550000'));assert(!JSON.stringify(carrier).includes('private-token'));
assert.equal(ownerCarrierDiagnostic({price:'-0.014000',price_unit:'USD',duration:'23'},true,true).durationValid,true);
console.log('Owner diagnostics distinguish consent/receipt failures without weakening acceptance or leaking speech, phones, tokens or raw errors.');
