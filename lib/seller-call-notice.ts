import {recordingConfidence,recordingContactOptOut} from './recording-consent-evidence.ts';
import {recordingBaseUrl,uuid} from './required-call-recording.ts';

export const sellerNoticeVersion='seller-notice-continued-speech-20261007';
export const sellerNoticeText="Hi, I'm an AI property assistant calling about a cash offer. This call will be recorded.";
const asset=(name:string)=>`<Play>https://www.geticashx.com/audio/seller-notice-20261007/${name}.mp3</Play>`;
export const sellerNoticeEndTwiml=`<Response>${asset('goodbye')}<Hangup/></Response>`;
export function sellerNoticeTwiml(id:string,nonce:string){
 if(!uuid(id)||!/^[a-f0-9]{64}$/.test(nonce))throw Error('RECORDING_BINDING_REQUIRED');
 return `<Response>${asset('notice')}<Gather input="speech" action="${recordingBaseUrl}/notice?id=${id}&amp;nonce=${nonce}" method="POST" actionOnEmptyResult="true" timeout="5" speechModel="default" language="en-US" speechTimeout="2">${asset('question')}</Gather><Hangup/></Response>`;
}
// Continued speech is recorded as such, never fabricated as an affirmative yes.
// Recording/privacy concerns and stop requests end before recording/AI starts.
export const sellerNoticeConcernPattern='\\b(no|not|cannot|busy|later|record|recording|recorded|recorder|tape|taping|transcript|transcription|privacy|private|consent|permission|stop|wait|hang up|goodbye|bye|refuse|decline|disagree|object)\\b';
export function sellerContinuedSpeech(form:URLSearchParams){
 const utterance=form.get('SpeechResult');
 if(form.has('UnstableSpeechResult')||form.getAll('SpeechResult').length!==1||form.getAll('Confidence').length>1||typeof utterance!=='string'||utterance.length>120||!/[a-zA-Z]{2}/.test(utterance)||/[\x00-\x1f]/.test(utterance))return null;
 if(recordingContactOptOut(form)||new RegExp(sellerNoticeConcernPattern,'i').test(utterance)||/^\s*(no|nope|nah|not now|not interested|do not|don't)[.!?\s]*$/i.test(utterance))return null;
 const confidence=recordingConfidence(form.get('Confidence'));if(confidence.status==='malformed')return null;
 return {utterance,confidenceReported:confidence.reported,resultKind:'gather_action_final',noticeVersion:sellerNoticeVersion};
}
