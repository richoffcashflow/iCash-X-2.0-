type Turn={role:string;content:string};

/** Preserve only an explicit unresolved original-payment review, not generic
 * operator text or a prior assistant claim. Never infer a billing change. */
export function hasUnresolvedLegacyBilling(messages:Turn[]){
 let active=false;
 for(const turn of messages){
  if(turn.role==='operator'){
   active=active&&/\b(?:1\.0|legacy|old)\b/i.test(turn.content)&&/\b(?:billing|recharge|payment)\b/i.test(turn.content)&&/\b(?:unresolved|unverified|keep this open)\b/i.test(turn.content)&&!/\b(?:resolved|no longer (?:an? )?(?:unresolved|unverified)|not unresolved|not unverified)\b/i.test(turn.content);
   continue;
  }
  if(turn.role!=='user')continue;
  const text=turn.content;
  const legacy=/\b1\.0\b|\bold iCash X\b/i.test(text);
  const charge=/\b(?:charg(?:e|ed|es|ing)|billing|deduct(?:ed|ing|ion)|recharge)\b/i.test(text);
  const report=/\b(?:still|attempt(?:s|ing|ed)?|tried|trying|charged|deducted|stop|disable)\b/i.test(text);
  // A polite request containing “if I could disable” is not hypothetical billing.
  const scope=text.replace(/\b(?:wanted|want|would like) to know if I (?:could|can) (?:disable|stop)\b/gi,'request to stop');
  const denied=/\b(?:if|hypothetically|will|would|might)\b.{0,25}\b(?:1\.0|old iCash X)\b[^.!?]{0,80}(?:charg|recharg)|\b(?:1\.0|old iCash X)\b.{0,20}\b(?:never|not|no longer|will|would|might|didn[’']?t|did not)\b[^.!?]{0,80}(?:charg|recharg)/i.test(scope);
  const clarify=/^(?:I (?:have )?already signed up for 2\.0|Accessing 2\.0 is not the issue|It is coming from 1\.0)\b/i.test(text)
   ||legacy&&/\blinked to my 1\.0 account\b/i.test(text)&&!/\bnot linked to my 1\.0 account\b/i.test(text);
  const oldScreen=legacy&&/\b(?:error|screen|message|shows)\b/i.test(text);
  const details=charge&&report&&/\b(?:failed|declined|pending|completed)\b/i.test(text)&&/\$\d|\b\d{1,2}\/\d{1,2}\b/.test(text);
  active=(legacy&&charge&&report||active&&(clarify||oldScreen||details))&&!denied&&!/\b(?:course|seller|buyer|contract|agreement)\b/i.test(text);
 }
 return active;
}
