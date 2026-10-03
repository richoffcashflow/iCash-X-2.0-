import {finalAffirmativeSpeech} from './recording-consent-evidence.ts';
export {recordingContactOptOut as ownerRecordingGateOptOut} from './recording-consent-evidence.ts';
export const ownerConsentEvidenceVersion='owner-final-natural-affirmative-advisory-v4';
export function ownerAffirmativeSpeech(form:URLSearchParams){const result=finalAffirmativeSpeech(form);return result?{...result,evidenceVersion:ownerConsentEvidenceVersion}:null;}
