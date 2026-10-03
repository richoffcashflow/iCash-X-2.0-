import {affirmativeUtterances} from './required-call-recording.ts';
import {ownerNaturalAffirmative,ownerSpeechShape} from './owner-natural-consent.ts';

import {recordingConfidence as ownerConfidence} from './recording-consent-evidence.ts';
export {recordingConfidence as ownerConfidence} from './recording-consent-evidence.ts';

/** Diagnostic metadata only. Never retain speech, phone numbers, callback URLs or tokens. */
export function ownerConsentDiagnostic(form:URLSearchParams){
 const text=form.get('SpeechResult'),score=ownerConfidence(form.get('Confidence')),confidenceStatus=score.status;
 const normalized=text?.trim().toLowerCase().replace(/[.!]+$/,'').trim();
 const speechStatus=text===null?'missing':!text.trim()?'empty':text.length>120?'oversized':(affirmativeUtterances as readonly string[]).includes(normalized??'')?'exact_affirmative':ownerNaturalAffirmative(text)?'natural_affirmative':'other';
 const unstable=form.has('UnstableSpeechResult');
 const reason=unstable?'consent_asr_unstable':confidenceStatus==='malformed'?'consent_confidence_malformed':'consent_not_verified';
 return {reason,speechStatus,confidenceStatus,confidence:score.value,confidenceReported:score.reported,unstable,speechShape:ownerSpeechShape(text)};
}

const recoveryCodes=new Set([
 'OWNER_RECORDING_STATE_CHANGED','OWNER_CONVERSATION_ID_PENDING','OWNER_CONVERSATION_BINDING_REQUIRED',
 'OWNER_CARRIER_PRICE_PENDING','OWNER_AI_USAGE_PENDING','OWNER_RECORDING_PRICE_PENDING',
 'OWNER_ACCOUNT_REVIEW_REQUIRED','OWNER_DELETE_BINDING_REQUIRED','OWNER_AUDIO_DELETE_PENDING',
 'OWNER_CALL_REVIEW_REQUIRED','OWNER_CALL_BINDING_REQUIRED','OWNER_END_UNCONFIRMED',
 'OWNER_RECORDING_OUTCOME_REVIEW','OWNER_RECORDING_BINDING_REQUIRED','OWNER_REQUIRED_AUDIO_ABSENT',
 'OWNER_RECORDING_START_UNKNOWN','OWNER_START_SAVE_REQUIRED','OWNER_CALL_TIME_EXHAUSTED',
]);
export function ownerRecoveryDiagnostic(error:unknown){
 const message=error instanceof Error?error.message:'';
 return recoveryCodes.has(message)?message:'OWNER_RECORDING_RECONCILIATION_REQUIRED';
}

/** The caller passes binding/terminal booleans; raw provider values never enter logs. */
export function ownerCarrierDiagnostic(call:Record<string,unknown>,bindingValid:boolean,terminal:boolean){
 return {bindingValid,terminal,pricePresent:call.price!==null&&call.price!==undefined,
  priceType:typeof call.price,priceFormatValid:typeof call.price==='string'&&/^-(?:\d+)(?:\.\d{1,6})?$|^0(?:\.0+)?$/.test(call.price),
  currencyUsd:call.price_unit==='USD',durationType:typeof call.duration,
  durationValid:typeof call.duration==='string'&&/^\d+$/.test(call.duration)&&Number(call.duration)<=60};
}
