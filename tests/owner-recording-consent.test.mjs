import assert from 'node:assert/strict';
import {ownerAffirmativeSpeech,ownerConsentEvidenceVersion} from '../lib/owner-recording-consent.ts';
import {affirmativeSpeech,affirmativeUtterances,consentTwiml,recordingDisclosure} from '../lib/required-call-recording.ts';
for(const phrase of affirmativeUtterances){
 const f=new URLSearchParams({SpeechResult:phrase+'!'}),e=ownerAffirmativeSpeech(f);assert(e);assert.equal(e.confidence,null);assert.equal(e.confidenceReported,null);assert.equal(e.confidenceBasis,'not_provided');assert.equal(e.evidenceVersion,ownerConsentEvidenceVersion);assert.equal(e.resultKind,'gather_action_final');assert.equal(affirmativeSpeech(f),null,'Production gate remains unchanged');
 f.set('Confidence','.99');assert.equal(ownerAffirmativeSpeech(f).confidence,.99);assert.equal(ownerAffirmativeSpeech(f).confidenceBasis,'provider_reported');
}
for(const phrase of ['', ' ', 'no', 'no yes', 'yes but no recording', 'not sure', 'can you record?', 'I said yes yesterday', 'not yes', 'do not record', 'x'.repeat(121)])for(const score of [null,'.99']){const f=new URLSearchParams({SpeechResult:phrase});if(score!==null)f.set('Confidence',score);assert.equal(ownerAffirmativeSpeech(f),null,phrase);}
for(const score of ['', ' ', '.89', '0', '-1', '1.1', 'NaN', 'Infinity', '0x1', '0b1', '0o1', '1e0', ' .99 ', '0.8999999999999999999999', '1.000000000000000000001', '0.'+'9'.repeat(31)])assert.equal(ownerAffirmativeSpeech(new URLSearchParams({SpeechResult:'yes',Confidence:score})),null);
assert.equal(ownerAffirmativeSpeech(new URLSearchParams({SpeechResult:'yes',UnstableSpeechResult:'yes'})),null);
assert.equal(ownerAffirmativeSpeech(new URLSearchParams({Confidence:'.99'})),null);
assert.equal(ownerAffirmativeSpeech(new URLSearchParams('SpeechResult=yes&SpeechResult=no')),null);
assert.equal(ownerAffirmativeSpeech(new URLSearchParams('SpeechResult=yes&Confidence=.99&Confidence=.10')),null);
const xml=consentTwiml('11111111-1111-4111-8111-111111111111','a'.repeat(64),recordingDisclosure('Synthetic business','Alex'));assert.equal((xml.match(/<Gather /g)||[]).length,1);assert(xml.includes('speechModel="default"'));assert(!xml.includes('input="dtmf'));assert(!xml.includes('<Record'));assert(!xml.includes('partialResultCallback'));assert(xml.includes('/consent?id='));
console.log('Owner v3 requires a clear full final affirmative, preserves absent confidence as null, rejects low/invalid/unstable evidence, and leaves production gate/one-Gather pricing unchanged.');

for(const score of ['.9','0.900000000000000000000001','0.912345678912345678912345678912','1.000000000000000000000000000000']){const e=ownerAffirmativeSpeech(new URLSearchParams({SpeechResult:'yes',Confidence:score}));assert(e);assert.equal(e.confidenceReported,score);}
