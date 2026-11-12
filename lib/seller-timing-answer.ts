import {object} from './required-call-recording.ts';

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
 const previous=String(turns.slice(0,index).findLast(t=>t.role==='agent')?.message??'');
 const question=(previous.match(/[^.!?;\n]+[.!?;]?/g)??[]).map(s=>s.trim()).filter(Boolean).at(-1)??'';
 if(!/^(?:(?:when (?:are you|would you|do you|did you|were you)|how (?:soon|quickly)).*(?:sell|close|move)(?: (?:the|this|your) (?:property|house|home))?|what(?:'s| is) your (?:selling |closing )?(?:timeline|timeframe))\?$/i.test(question)
  ||/\b(?:price|offer|repair|roof|mortgage|debt|lien|tax|owner|listed|agent|inspection|contract|agreement)\b/i.test(question))return false;
 const clean=answer.toLowerCase().replace(/[’]/g,"'").replace(/^(?:(?:yes|yeah|well|um|uh|ideally)[,. ]+)+/,'')
  .replace(/^i(?:'m| am) (?:looking|hoping|planning|trying|ready) to (?:sell|close|move)\b[ ,]*/,'')
  .replace(/^i (?:want|wanna|need|plan|would like|hope) to (?:sell|close|move)\b[ ,]*/,'')
  .replace(/^(?:within|in|by|around|about|over) (?:the )?/,'').replace(/[.! ]+$/,'');
 const number='(?:\\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|forty-five|sixty|ninety)';
 const duration=new RegExp('^(?:the )?(?:next )?'+number+'(?:\\s*(?:to|[-–])\\s*'+number+')?\\s+(?:days?|weeks?|months?)(?:,? (?:as soon as possible|if possible))?$');
 return duration.test(clean)||/^(?:as soon as possible|asap|right away|immediately|no rush|no deadline|not sure(?: yet)?|i don't know(?: yet)?|(?:next|this) (?:week|month|year)|a (?:few|couple(?: of)?) (?:days|weeks|months))$/.test(clean);
}
