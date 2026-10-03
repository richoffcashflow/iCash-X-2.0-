import assert from 'node:assert/strict';
import {naturalYes,naturalNo,ownerOptOutCases} from './helpers/owner-natural-consent-cases.mjs';
import {ownerNaturalAffirmative} from '../lib/owner-natural-consent.ts';
import {ownerAffirmativeSpeech,ownerRecordingGateOptOut} from '../lib/owner-recording-consent.ts';
import {ownerConsentDiagnostic} from '../lib/owner-recording-diagnostics.ts';
for(const text of naturalYes){assert.equal(ownerNaturalAffirmative(text),true,text);for(const confidence of [null,'0.97909707']){const f=new URLSearchParams({SpeechResult:text});if(confidence!==null)f.set('Confidence',confidence);const e=ownerAffirmativeSpeech(f);assert(e,text);assert.equal(e.utterance,text);assert.equal(e.evidenceVersion,'owner-final-natural-affirmative-v3');}}
for(const text of naturalNo){assert.equal(ownerNaturalAffirmative(text),false,String(text));const f=new URLSearchParams({Confidence:'.99'});if(text!==null)f.set('SpeechResult',text);assert.equal(ownerAffirmativeSpeech(f),null,String(text));}
for(const phrase of naturalYes)for(const qualifier of ['no','not','never','but no','if','unless','maybe','I guess','stop calling','do not call','not now','except']){assert.equal(ownerNaturalAffirmative(qualifier+' '+phrase),false);assert.equal(ownerNaturalAffirmative(phrase+' '+qualifier),false);}
for(const field of ['UnstableSpeechResult','SpeechResult','Confidence']){const f=new URLSearchParams({SpeechResult:'Yes, that’s fine.',Confidence:'.99'});f.append(field,'yes');assert.equal(ownerAffirmativeSpeech(f),null);}
assert.equal(ownerAffirmativeSpeech(new URLSearchParams({SpeechResult:'yes yes',Confidence:'.89'})),null);
const diag=ownerConsentDiagnostic(new URLSearchParams({SpeechResult:'Yes, yes, that’s fine!',Confidence:'0.97909707'}));assert.equal(diag.speechStatus,'natural_affirmative');assert.deepEqual(diag.speechShape,{comma:true,curlyApostrophe:true,question:false,repeatedAffirmative:true});assert(!JSON.stringify(diag).includes('fine'));
console.log('Owner natural consent: whole-response grammar, punctuation/contractions/repetition, exact confidence, qualifiers/negation/ambiguity/duplicate/partial rejection; diagnostic shape only.');

for(const text of ownerOptOutCases)assert(ownerRecordingGateOptOut(new URLSearchParams({SpeechResult:text})),text);
for(const text of ['No thanks','No recording','Yes, that’s fine.'])assert.equal(ownerRecordingGateOptOut(new URLSearchParams({SpeechResult:text})),null,text);
// The copied transition may change consent only; prior lock/settlement/end behavior stays byte-identical.
const {readFileSync}=await import('node:fs');
const previous=readFileSync(new URL('../config/owner-recording-retained-reservation.sql',import.meta.url),'utf8');
const next=readFileSync(new URL('../config/owner-recording-natural-consent-v3.sql',import.meta.url),'utf8');
const transition=text=>text.slice(text.indexOf('create or replace function public.icash_transition_owner_recording_test'),text.indexOf('end $$;',text.indexOf('create or replace function public.icash_transition_owner_recording_test'))+7);
const [oldBefore,oldConsentAndAfter]=transition(previous).split(" elsif p_action='consent' then");
const [newBefore,newConsentAndAfter]=transition(next).split(" elsif p_action='consent' then");
assert.equal(newBefore,oldBefore);assert.equal(newConsentAndAfter.slice(newConsentAndAfter.indexOf(" elsif p_action='claim_start' then")),oldConsentAndAfter.slice(oldConsentAndAfter.indexOf(" elsif p_action='claim_start' then")));
