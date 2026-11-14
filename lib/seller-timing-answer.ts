import {object} from './required-call-recording.ts';

function timingWords(answer:string){
 return answer.toLowerCase().replace(/[’]/g,"'").replace(/^(?:(?:yes|yeah|well|um|uh|ideally)[,. ]+)+/,'')
  .replace(/^i(?:'m| am) (?:looking|hoping|planning|trying|ready) to (?:sell|close|move)\b[ ,]*/,'')
  .replace(/^i (?:want|wanna|need|plan|would like|hope) to (?:sell|close|move)\b[ ,]*/,'')
  .replace(/^(?:within|in|by|around|about|over) (?:the )?/,'').replace(/[.! ]+$/,'');
}
function routineTimingWords(clean:string){
 const number='(?:\\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|forty-five|sixty|ninety)';
 const duration=new RegExp('^(?:the )?(?:next )?'+number+'(?:\\s*(?:to|[-–])\\s*'+number+')?\\s+(?:days?|weeks?|months?)(?:,? (?:as soon as possible|if possible))?$');
 return duration.test(clean)||/^(?:as soon as possible|asap|right away|immediately|no rush|no deadline|not sure(?: yet)?|i don't know(?: yet)?|(?:next|this) (?:week|month|year)|a (?:few|couple(?: of)?) (?:days|weeks|months))$/.test(clean);
}

/** A source-bound answer about selling time is not an ownership or financial
 * correction. Accept only timing language, so a mixed answer cannot hide a
 * changed price, debt, property, owner or repair disclosure. */
export function sellerRoutineTimingAnswer(value:unknown,input:Record<string,unknown>):boolean{
 if(input.action!=='report_change')return false;
 const rows=object(value).transcript;if(!Array.isArray(rows))return false;
 const turns=rows.map(object).filter(t=>['user','agent'].includes(String(t.role))&&typeof t.message==='string');
 const index=turns.findLastIndex(t=>t.role==='user');if(index<1)return false;
 const answer=String(turns[index].message).trim();
 if(answer!==String(input.sellerStatement??'').trim())return false;
 let previousIndex=turns.findLastIndex((turn,n)=>n<index&&turn.role==='agent');
 // A presence check can interrupt the caller halfway through a timeline.
 // Reconnect only this adjacent question/answer/nudge/answer sequence. The
 // interrupted words must themselves be timing-only; do not hide a material
 // disclosure, skip another real question or search arbitrary older history.
 if(previousIndex===index-1&&/^(?:are you still there|can you hear me)[?.! ]*$/i.test(String(turns[previousIndex].message).trim())
  &&previousIndex>=2&&turns[previousIndex-1].role==='user'&&turns[previousIndex-2].role==='agent'){
  const interrupted=String(turns[previousIndex-1].message).trim();
  const partial=/[-–—…]$/.test(interrupted)&&/^(?:(?:the )?next)?$/.test(timingWords(interrupted.replace(/[-–—…]+$/,'')));
  if(partial||routineTimingWords(timingWords(interrupted)))previousIndex-=2;
 }
 const previous=String(turns[previousIndex]?.message??'');
 const question=(previous.match(/[^.!?;\n]+[.!?;]?/g)??[]).map(s=>s.trim()).filter(Boolean).at(-1)??'';
 if(!/^(?:(?:when (?:are you|would you|do you|did you|were you)|how (?:soon|quickly)).*(?:sell|close|move)(?: (?:the|this|your) (?:property|house|home))?|what(?:'s| is) your (?:selling |closing )?(?:timeline|timeframe))\?$/i.test(question)
  ||/\b(?:price|offer|repair|roof|mortgage|debt|lien|tax|owner|listed|agent|inspection|contract|agreement)\b/i.test(question))return false;
 return routineTimingWords(timingWords(answer));
}
