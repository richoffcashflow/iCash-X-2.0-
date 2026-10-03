import {ownerNaturalAffirmative} from './owner-natural-consent.ts';
import {ownerConfidence} from './owner-recording-diagnostics.ts';

export const ownerConsentEvidenceVersion='owner-final-natural-affirmative-v3';
/** Call only after the final action webhook's signature, nonce and canonical call binding pass.
 * Twilio does not guarantee Confidence. Missing is recorded as missing, never as a score.
 * A reported low/invalid score, partial text, silence or non-affirmative response still rejects.
 */
export function ownerAffirmativeSpeech(form:URLSearchParams){
 const utterance=form.get('SpeechResult'),raw=form.get('Confidence');
 if(form.has('UnstableSpeechResult')||form.getAll('SpeechResult').length!==1||form.getAll('Confidence').length>1||typeof utterance!=='string'||utterance.length>120||!ownerNaturalAffirmative(utterance))return null;
 const score=ownerConfidence(raw);if(score.status!=='missing'&&score.status!=='valid')return null;
 return {utterance,confidence:score.value,confidenceReported:score.reported,evidenceVersion:ownerConsentEvidenceVersion,resultKind:'gather_action_final' as const,confidenceBasis:score.status==='missing'?'not_provided' as const:'provider_reported' as const};
}

/** Contact requests are conservative and independent of the shorter affirmative grammar.
 * The verified final webhook already has a 16 KiB body bound. Never truncate a stop request.
 */
export function ownerRecordingGateOptOut(form:URLSearchParams){
 const text=form.get('SpeechResult');if(typeof text!=='string'||form.has('UnstableSpeechResult'))return null;
 const normalized=text.replace(/[’‘]/g,"'").replace(/[,\.!]/g,' ').replace(/\s+/g,' ').trim();
 const stop=/\b((do not|don't|never) (ever )?(call|text|contact)|(stop|quit) (calling|texting|contacting)|(stop|no more) (these |the )?(calls|texts|messages)|(do not|don't) want (you|your (company|business)) to (ever )?(call|text|contact)|(do not|don't) want (any (more )?|anymore |more )?(calls|texts|contact)|remove (me|my number)|take (me|my number) off)\b/i;
 return stop.test(normalized)?text:null;
}
