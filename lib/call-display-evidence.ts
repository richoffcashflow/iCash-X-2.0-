import {sellerResponseDisposition,sellerResponsePatterns} from './seller-response-policy.ts';
const voicemail=/leave (?:a|an|your) (?:additional )?message|record (?:a|your) message|(?:at|after) the (?:beep|tone)|mailbox (?:is|has)|voicemail (?:for|system)|call has been forwarded|buz[oó]n de voz|correo de voz|(?:graba|grabe|deja|deje).{0,25}mensaje|despu[eé]s.{0,15}(?:tono|se[nñ]al)/i;
/** Hide only a confirmed automated greeting with no saved human response.
 * A short call, missing transcript, or human mentioning voicemail stays visible. */
export function isConfirmedVoicemail(transcript:unknown):boolean{
 if(!Array.isArray(transcript))return false;
 const words=transcript.filter(t=>t&&t.role==='user'&&typeof t.message==='string').map(t=>t.message as string);
 const greeting=(word:string)=>voicemail.test(word)&&new RegExp(sellerResponsePatterns.machine,'i').test(word.trim())&&!sellerResponseDisposition(word)&&!/(?:i (?:want|would like|am interested)|i'm interested|my (?:house|property)|our (?:house|property)|\$[0-9])/i.test(word);
 const silence=/^\s*[\[(*]?\s*(?:music|silence|noise|background noise|inaudible|unintelligible|no speech|no audio)\s*[\])*]?\s*[.!]*\s*$/i;
 return words.some(greeting)&&words.every(word=>greeting(word)||silence.test(word)||!/[\p{L}\p{N}]/u.test(word));
}
