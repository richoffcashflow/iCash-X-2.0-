type Turn={role:string;content:string};
const normalize=(text:string)=>text.toLowerCase().replace(/[’']/g,'').replace(/\s+/g,' ').trim();
export function supportFailedStep(text:string){
 const q=normalize(text);
 if(/^(?:what if|can|could|does|will|how|is it possible)\b/.test(q))return false;
 return /\b(?:still (?:doesnt|does not|isnt|is not|cant|cannot|not|no|nothing|missing|locked|broken)|(?:that|it|this) (?:didnt|did not) (?:work|help)|(?:already|just) (?:tried|did|followed).{0,60}(?:nothing|no |not |failed|same|cant|cannot)|same (?:issue|problem|error)|you keep (?:asking|repeating)|going in circles)\b/.test(q);
}
export function supportIssueDomain(text:string){
 if(/\b(?:sign[ -]?in|log[ -]?in|code|access|locked|email)\b/i.test(text))return 'access';
 if(/\b(?:charge|charged|payment|paid|credits?|refund|cancel|subscription|money)\b/i.test(text))return 'billing';
 if(/\b(?:audio|microphone|speaker|hear|playback|custom voice)\b/i.test(text))return 'audio';
 if(/\b(?:agreement|contract|signature|title|closing)\b/i.test(text))return 'contracts';
 if(/\b(?:bot|seller|leads?|properties|calls?|texts?|outreach|number)\b/i.test(text))return 'outreach';
 return null;
}
/** Two actual failed follow-ups, not two mentions of an issue. A new subject or
 * operator response starts a new sequence; a positive result ends it. */
export function supportRepeatedFailedSteps(messages:Turn[]){
 const latest=messages.findLastIndex(m=>m.role==='user');
 if(latest<0||!supportFailedStep(messages[latest].content))return false;
 const recent=messages.slice(Math.max(0,messages.slice(0,latest).findLastIndex(m=>m.role==='operator')+1),latest+1).slice(-12);
 let domain:string|null=null,failures=0,replied=false;
 for(const message of recent){
  if(message.role==='assistant'){replied=true;continue;}
  if(message.role!=='user')continue;
  const next=supportIssueDomain(message.content);
  if(next&&domain&&next!==domain){failures=0;replied=false;}
  if(next)domain=next;
  if(supportCustomerConfirmedResolution(message.content)){failures=0;replied=false;continue;}
  if(supportFailedStep(message.content)&&replied)failures++;
  else if(!supportFailedStep(message.content))failures=0;
  replied=false;
 }
 return failures>=2;
}
export function supportCustomerConfirmedResolution(text:string){
 return /\b(?:that worked|it worked|working now|fixed now|all fixed|problem solved|got in|i[’']?m in now|i can (?:log|sign) in now)\b/i.test(text)&&!/\b(?:not|still|but|however|can[’']?t|cannot|didn[’']?t)\b/i.test(text);
}
export function supportPaymentAccessConcern(text:string){
 if(/\b(?:what if|hypothetically|if i (?:am|were)|how (?:do|can) i avoid)\b/i.test(text))return false;
 return /\b(?:charged twice|double charged|duplicate charge|(?:dont|don[’']t|do not) recognize (?:this |the |a )?charge|paid.{0,60}(?:locked|no access|cant|can[’']t|cannot|missing)|(?:account|access) (?:is |still |is still )?(?:locked|blocked|unavailable)|(?:credits?|payment).{0,30}(?:missing|not (?:received|showing|added))|(?:cant|can[’']t|cannot).{0,30}(?:log|sign) in)\b/i.test(text);
}
export function supportDisputeLanguage(text:string){
 if(/\b(?:what if|what is|whats a|what[’']s a|how (?:do|can) i avoid|seller|buyer|deposit)\b/i.test(text)||/\b(?:not|never|won[’']?t|don[’']?t|do not|no need to)\b.{0,30}\b(?:file|dispute|chargeback)\b/i.test(text))return false;
 return /\b(?:i(?:[’']m| am| will|[’']ll)?|going to|file|filing|filed|open|opening|opened)\b.{0,50}\b(?:chargeback|bank dispute|dispute with (?:my |the )?bank)\b|\b(?:disputing|disputed).{0,35}\b(?:charge|payment)\b/i.test(text);
}
