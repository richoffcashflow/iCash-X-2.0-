import {sellerResponseDisposition} from './seller-response-policy.ts';

/** Source audio markers and automated prompts are not a seller response.
 * Keep the PostgreSQL predicate and parity fixtures aligned. Never discard the
 * original transcript, or suppress a real stop-contact request. */
export const automatedCallPattern='leave (a |an |your )?(additional )?message|record (a |your )?message|(at|after) the (beep|tone)|mailbox (is|has)|voicemail (for|system)|has been disconnected|number you (have )?dialed|press (one|two|three|four|five|six|seven|eight|nine|zero|pound|star|[0-9#*])|automated (voice|system)|please (stay|hold|remain) on the line|please (say|state) your name|screening (this|your) call|call has been forwarded|cannot take your call|can.t take your call';
const audioMarker=/^\s*[\[(*]?\s*(?:music|silence|noise|background noise|inaudible|unintelligible|no speech|no audio)\s*[\])*]?\s*[.!]*\s*$/i;
export function hasHumanCallWords(message:string){
 if(sellerResponseDisposition(message)==='opt_out')return true;
 return /\p{L}/u.test(message)&&!audioMarker.test(message)&&!new RegExp(automatedCallPattern,'i').test(message);
}
export function callContactEvidence(transcript:{role:string;message?:string|null}[]){
 const words=transcript.filter(t=>t.role==='user'&&typeof t.message==='string').map(t=>t.message!);
 if(words.some(hasHumanCallWords))return 'human_response' as const;
 return words.some(t=>new RegExp(automatedCallPattern,'i').test(t))?'automated_answer' as const:'no_response' as const;
}

export const automatedAnswerInstructions=`AUTOMATED ANSWERS: A voicemail greeting, request to record a message, beep, phone menu, or call-screening assistant is not the owner. End the call immediately with end_call when you hear one. Do not leave a message, navigate menus, give a property address to a screening assistant, negotiate, or schedule a callback from automated audio. Music, noise, an ellipsis transcript, and silence are not answers. If no understandable person responds, ask once whether anyone is there, then use end_call after the next unanswered turn. Do not repeat the greeting or questions through repeated silence. If a person is speaking or asks for a moment, let them finish; do not treat a normal pause or their mention of voicemail as an automated answer.`;
