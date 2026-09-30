import assert from 'node:assert/strict';
import {voiceCostManifest} from '../lib/voice-cost-settlement.ts';
import {costCategories} from '../lib/cost-guard.ts';
const fixture=()=>Object.fromEntries(costCategories.map(k=>[k,{kind:'receipt',amountMicros:k==='elevenlabs'?10000:0,evidenceRef:'isolated fixture receipt'}]));
let p=fixture();p.support_and_overhead={kind:'fixed_estimate',amountMicros:1000,evidenceRef:'reviewed fixed allocation'};
p.twilio={kind:'duration_estimate',durationSeconds:3,unitSeconds:60,microsPerUnit:14000,rounding:'up',minimumUnits:0,evidenceRef:'fixture supplier unit rule',durationEvidenceRef:'fixture carrier duration'};
assert.equal(voiceCostManifest(p).totalMicros,25000);assert.equal(voiceCostManifest(p).costBasis,'estimated');
p.twilio.durationSeconds=600;assert.equal(voiceCostManifest(p).totalMicros,151000);
p.twilio.durationSeconds=601;assert.equal(voiceCostManifest(p).totalMicros,165000); // carrier can exceed agent cap
p.twilio.durationSeconds=null;assert.throws(()=>voiceCostManifest(p),/duration/);
p.twilio.durationSeconds=3;p.twilio.rounding='exact';assert.equal(voiceCostManifest(p).components.twilio.amountMicros,700);
p.twilio.minimumUnits=1;assert.equal(voiceCostManifest(p).components.twilio.amountMicros,14000);
p=fixture();assert.equal(voiceCostManifest(p).costBasis,'verified');
p.llm.amountMicros=1;assert.throws(()=>voiceCostManifest(p),/separate LLM/);
p=fixture();p.elevenlabs.kind='fixed_estimate';assert.throws(()=>voiceCostManifest(p),/inclusive receipt/);
p=fixture();delete p.github;assert.throws(()=>voiceCostManifest(p),/Complete/);
p=fixture();p.twilio.amountMicros=Infinity;assert.throws(()=>voiceCostManifest(p),/Invalid/);
console.log('PASS: voice receipts, 3/600/601 seconds, carrier rounding, minima, fixed overhead, missing duration, inclusive LLM, labels and malformed evidence');
