import {affirmativeUtterances} from './required-call-recording.ts';
import {ownerConfidence} from './owner-recording-diagnostics.ts';

export const ownerConsentEvidenceVersion='owner-final-affirmative-optional-confidence-v2';
/** Call only after the final action webhook's signature, nonce and canonical call binding pass.
 * Twilio does not guarantee Confidence. Missing is recorded as missing, never as a score.
 * A reported low/invalid score, partial text, silence or non-exact affirmative still rejects.
 */
export function ownerAffirmativeSpeech(form:URLSearchParams){
 const utterance=form.get('SpeechResult'),raw=form.get('Confidence');
 const normalized=utterance?.trim().toLowerCase().replace(/[.!]+$/,'').trim();
 if(form.has('UnstableSpeechResult')||form.getAll('SpeechResult').length!==1||form.getAll('Confidence').length>1||typeof utterance!=='string'||utterance.length>120||!(affirmativeUtterances as readonly string[]).includes(normalized??''))return null;
 const score=ownerConfidence(raw);if(score.status!=='missing'&&score.status!=='valid')return null;
 return {utterance,confidence:score.value,confidenceReported:score.reported,evidenceVersion:ownerConsentEvidenceVersion,resultKind:'gather_action_final' as const,confidenceBasis:score.status==='missing'?'not_provided' as const:'provider_reported' as const};
}
