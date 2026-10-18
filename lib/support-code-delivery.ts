type Turn={role:string;content:string};

/** Only customer reports advance delivery state; support instructions are not proof of receipt. */
export function supportCodeDelivery(messages:Turn[]):'missing'|'received'|'unknown'{
 let state:'missing'|'received'|'unknown'='unknown';
 let codeContext=false;
 for(const turn of messages){
  if(turn.role!=='user')continue;
  const text=turn.content.replace(/[’‘]/g,"'");
  codeContext ||= /\b(?:code|sign[ -]?in|log[ -]?in|email|text|sms|inbox)\b/i.test(text);
  if(!codeContext)continue;
  const missing=/\b(?:not|never|didn't|don't|doesn't|hasn't|haven't|isn't|wasn't|won't|wouldn't|can't|cannot)\s+(?:(?:been|being|ever|yet|still|even)\s+){0,2}(?:send(?:ing)?|sent|receiv(?:e|ed|ing)|arriv(?:e|ed|ing)|come|came|email(?:ed|ing)?|text(?:ed|ing)?)\b/i.test(text)
   ||/\b(?:not|never|didn't|don't|haven't|can't|cannot)\s+(?:get(?:ting)?|got(?:ten)?)\s+(?:\w+[ -]){0,5}(?:code|email|text|sms|either|anything|it)\b/i.test(text)
   ||/\b(?:no|without|missing)\s+(?:(?:sign[ -]?in|login|email|text|sms|verification|a|the|any|new|fresh)\s+){0,3}(?:code|email|text|sms)\b/i.test(text)
   ||/\bstill waiting\b|\bnothing (?:arrived|received|in (?:my )?(?:inbox|spam|junk))\b/i.test(text);
  const received=/\b(?:got|received|entered|typed|pasted|filled(?: out)?|have)\s+(?:(?:a|the|my|that|this|new|newest|email|text|sms|sign[ -]?in|login|verification)\s+){0,5}code\b|\b(?:code|email|text)\s+(?:arrived|came through)\b|\b(?:got|received) it (?:now|finally)\b/i.test(text);
  const rejected=/\bno (?:email |text |sign[ -]?in )?codes? (?:works?|worked|is working)\b/i.test(text);
  if(rejected)state='received';else if(missing)state='missing';else if(received)state='received';
 }
 return state;
}
