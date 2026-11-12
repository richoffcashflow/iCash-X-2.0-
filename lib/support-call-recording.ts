import type {SupportContext,SupportReply} from './support-conversation.ts';

const recording=(s:string)=>/\b(?:recordings?|record(?:ed|ing)? audio|audio recording)\b/i.test(s);
const call=(s:string)=>/\b(?:calls?|seller)\b/i.test(s);
const failure=(s:string)=>/\b(?:no|missing|cannot|can[’']?t|not|won[’']?t|doesn[’']?t|failed|error|unavailable)\b/i.test(s);
/** Aggregate activity cannot establish whether a particular call has playable audio. */
export function supportCallRecordingReply(context:SupportContext):SupportReply|null{
 const i=context.messages.findLastIndex(m=>m.role==='user'),q=context.messages[i]?.content??'';
 if(!recording(q)||/\b(?:voicemail|answering.machine|beep|refund|cancel|charged|custom voice|clone|upload|training|course)\b/i.test(q))return null;
 let prior='';
 for(let n=i-1;n>=0;n--){const m=context.messages[n];if(m.role==='operator')break;if(m.role==='user'){prior=m.content;break;}}
 const current=call(q),followup=/\b(?:system|able|can|does|record)\b/i.test(q)&&recording(prior)&&call(prior);
 if(!current&&!followup)return null;
 const issue=failure(q)||followup&&failure(prior);
 const guide='iCash X can show saved seller-call recordings in the property’s conversation. A recorded call attempt does not confirm that playable audio was saved. These account checks do not verify a particular recording, and I haven’t confirmed why yours is missing.';
 return {reply:issue?guide+' Which property and call time is affected?':'Open the property under Your leads and check its conversation for saved call recordings. Not every call attempt has playable audio; this does not confirm that a particular recording was saved.',status:'open',ai:false};
}
