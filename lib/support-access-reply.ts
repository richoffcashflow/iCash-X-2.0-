import type {AccessInvestigation} from './support-access-investigation.ts';
type Turn={role:string;content:string};
const normalize=(text:string)=>text.replace(/[’‘]/g,"'");

/** Missing delivery is different from a rejected code. Failed steps are never a resend loop. */
export function missingAccessCodeReply(messages:Turn[],check?:AccessInvestigation){
 const users=messages.filter(m=>m.role==='user').map(m=>normalize(m.content));
 const replies=messages.filter(m=>m.role==='assistant'||m.role==='operator').map(m=>normalize(m.content));
 const question=users.at(-1)??'',history=users.join('\n');
 const asked=(pattern:RegExp)=>replies.some(reply=>pattern.test(reply));
 const already=/already|few times|several times|many times|again|did that|done that|tried that|tried it/i.test(question);
 const bothTried=users.some(text=>/^both[.!\s]*$/i.test(text)||/(?:tried|used|requested).{0,40}both|both.{0,50}(?:tried|no code|not.*(?:send|arrive))/i.test(text)
  ||(/email/i.test(text)&&/phone|text|sms/i.test(text)&&/no code|no .*code|not gotten|not received|haven't received|already used|tried|nothing/i.test(text)));
 const receiptKnown=asked(/email on your iCash X payment receipt|receipt email match/)
  ||users.some(text=>/(?:email|receipt).{0,30}match|matches.{0,20}receipt/i.test(text));
 const emailTried=asked(/request (?:one|a) fresh code|check.{0,30}(?:spam|junk)/)
  ||users.some(text=>/(?:tried|requested|resent|resend).{0,30}(?:email|code)|(?:email|code).{0,30}(?:few|several|many) times/i.test(text))||bothTried;
 const phoneTried=asked(/optional receipt email blank|select .Text me a code.|request one fresh text code/)
  ||bothTried||users.some(text=>/(?:used|tried).{0,35}(?:phone|text)|(?:phone|text).{0,35}(?:no code|didn't|not receive)/i.test(text));
 const checked=check?.checked===true;
 const prefix=check?.phone==='unavailable'?'Text sign-in is currently unavailable. ':!checked?'I can’t verify the sign-in checks right now, so I can’t confirm delivery. ':'';
 const open=(reply:string)=>({reply:replies.includes(normalize(reply))?'There’s no confirmed change to your access yet. Your earlier answers are saved; repeating those steps won’t give us a new result. This issue remains open.':reply,status:'open' as const,ai:false});
 const ask=(reply:string)=>({reply,status:'waiting_on_customer' as const,ai:false});
 const operator=messages.filter(m=>m.role==='operator').at(-1)?.content??'';
 if(/checkout email.{0,50}(?:differ|does not match|doesn't match)|(?:matched|matches).{0,40}(?:payment|receipt)|(?:payment|receipt).{0,40}(?:matched|matches)/i.test(operator)){
  return open('The payment check already recorded in this conversation is the next step to follow. You don’t need to repeat the code requests or send the same payment proof again. Access is still unresolved; this chat has not changed your sign-in email or restored access.');
 }
 if(/(?:are|will|can) you.{0,25}send|send (?:it|the code|my code)|you(?:'re| are) not sending/i.test(question))return open('I haven’t sent a code from this chat. '+prefix+(emailTried||phoneTried?'Repeated requests haven’t fixed this, and I won’t ask you to keep resending. ':'Code delivery is still unconfirmed. ')+'Your access issue is still open.');
 if(!receiptKnown&&!bothTried)return ask(prefix+'Check the email on your iCash X payment receipt. Does it match the email you entered on the sign-in page? Don’t share any sign-in code.');
 if(check?.email!=='unavailable'&&!emailTried&&!already)return ask(prefix+'Use the email on your payment receipt to request one fresh code, then check that inbox and its spam or junk folder. Does a code arrive?');
 if(check?.phone==='configured'&&!phoneTried&&!already)return ask('Email hasn’t worked. Choose “Use my checkout phone,” leave the optional receipt email blank, and select “Text me a code.” Does a box labeled “Text code” appear? Don’t share the code.');
 if(!asked(/main button|field labels and button text/)&&!users.some(text=>/no (?:error )?message|nothing (?:appears|happens)|doesn't (?:say|show) anything/i.test(text)))return ask(prefix+'You’ve already tried requesting a code, so please don’t request another yet. What does the main button say now: “Email me a code,” “Text me a code,” “Sign in,” or “One moment…”?');
 if(!asked(/payment date and amount|date and amount on (?:your|the) receipt/)&&!users.some(text=>/\$\s*\d|\d\s*\$/.test(text)))return ask(prefix+'The code requests haven’t restored access. What are the payment date and amount on your receipt? Leave out card details and codes; you don’t need to pay again.');
 if(already)return open('You already tried the suggested steps. I don’t have a confirmed delivery or an access fix, so I’m keeping this issue open. No more code requests are needed right now.');
 return open(prefix+(checked?'I checked the available sign-in records, but those checks do not confirm that a code reached you. ':'')+'Access is still unresolved. Your earlier details are saved here; I won’t restart the same instructions.');
}
