import {sellerResponseDisposition} from './seller-response-policy.ts';
import {sellerAnswerText} from './seller-answer-evidence.ts';
export const sellerCommunicationPatterns={
 return_call:"^(?:can|could|may) i call (?:you |back )?(?:back )?later[?! .]*$",
 email:"^(?:email|e-mail)(?: me| it| the (?:offer|details|agreement))?(?: please)?[.! ]*$",
 language:"^(?:i (?:do not|don't|cannot|can't) (?:speak|understand) english|no (?:hablo|entiendo) ingl[eé]s)[.! ]*$",
};
export const sellerCommunicationReplies={
 return_call:"Yes, you can call back when you're ready.",
 email:'Would you like the offer details or the agreement by email?',
 language:'What language would you prefer? / Que idioma prefiere?',
};
export function sellerCommunicationIntent(source:string):keyof typeof sellerCommunicationReplies|null{
 const body=sellerAnswerText(source).toLowerCase();
 if(body.length>300||sellerResponseDisposition(body)!==null)return null;
 return (Object.keys(sellerCommunicationPatterns) as (keyof typeof sellerCommunicationPatterns)[]).find(key=>new RegExp(sellerCommunicationPatterns[key],'i').test(body))??null;
}
export function sellerCommunicationPreferences(history:unknown[]){
 const preferences:{channel?:'email'|'text';language?:string;callerWillReturn?:boolean}={};
 for(const c of history){
  const rows=(c as {transcript?:{role?:string;message?:string}[]})?.transcript;if(!Array.isArray(rows))continue;
  let question='';
  for(const row of rows){
   if(typeof row.message!=='string')continue;
   if(row.role==='agent'){question=row.message;continue;}if(row.role!=='user')continue;
   const intent=sellerCommunicationIntent(row.message);
   if(intent==='email')preferences.channel='email';
   if(/^(?:text only|only text|just text me|i prefer texting)[.! ]*$/i.test(row.message))preferences.channel='text';
   if(intent==='return_call')preferences.callerWillReturn=true;
   if(/\b(?:what language|que idioma)\b/i.test(question)){
    const language=row.message.trim().replace(/[.!]+$/,'').toLowerCase();
    const names:Record<string,string>={spanish:'Spanish',espanol:'Spanish','español':'Spanish',english:'English',ingles:'English','inglés':'English',portuguese:'Portuguese',french:'French',vietnamese:'Vietnamese',mandarin:'Mandarin'};
    if(names[language])preferences.language=names[language];
   }
  }
 }
 return preferences;
}
