import {sellerResponseDisposition,sellerResponsePatterns} from './seller-response-policy.ts';
const voicemail=/leave (?:a|an|your) (?:additional )?message|record (?:a|your) message|(?:at|after) the (?:beep|tone)|mailbox (?:is|has)|voicemail (?:for|system)|call has been forwarded|buz[oó]n de voz|correo de voz|(?:graba|grabe|deja|deje).{0,25}mensaje|despu[eé]s.{0,15}(?:tono|se[nñ]al)/i;
// Exact automated fragments observed in saved calls. Do not hide a conversation
// when a later turn contains a person, even after an automated greeting.
const machineFragment=/^(?:\.{0,3}\s*)?(?:(?:(?:when you have )?finished |this is )?recording[,.]? you may hang up[.!]?|(?:thanks[.!] )?please stay on the line[.!]?|i am a virtual assistant that helps people with their calls when they(?:'|’)re busy\. they wanted me to check the reason for the call before connecting you to them\.|unfortunately, the person you(?:'|’)re calling cannot take your call right now\. have a nice day\.|(?:i(?:'|’)m sorry, )?this person is not available\. if you would like to leave an additional message, please reply after the tone\.|nothing has been recorded\. record your message after the tone\. simply hang up when done\. or for delivery options, press the pound sign\.|(?:[0-9 -]+\. )?sorry, mailbox is full\. to send an sms notification, press five\.|to send an sms notification, press five\.|thank you for calling\. goodbye\.)$/i;
/** Hide only a confirmed automated greeting with no saved human response.
 * A short call, missing transcript, or human mentioning voicemail stays visible. */
export function isConfirmedVoicemail(transcript:unknown):boolean{
 if(!Array.isArray(transcript))return false;
 const words=transcript.filter(t=>t&&t.role==='user'&&typeof t.message==='string').map(t=>t.message as string);
 const greeting=(word:string)=>(machineFragment.test(word.trim())||voicemail.test(word)&&new RegExp(sellerResponsePatterns.machine,'i').test(word.trim()))&&!sellerResponseDisposition(word)&&!/(?:i (?:want|would like|am interested)|i'm interested|my (?:house|property)|our (?:house|property)|\$[0-9])/i.test(word);
 const silence=/^\s*[\[(*]?\s*(?:music(?: playing)?|silence|noise|background noise|inaudible|unintelligible|no speech|no audio)\s*[\])*]?\s*[.!]*\s*$/i;
 return words.some(greeting)&&words.every(word=>greeting(word)||silence.test(word)||!/[\p{L}\p{N}]/u.test(word));
}
