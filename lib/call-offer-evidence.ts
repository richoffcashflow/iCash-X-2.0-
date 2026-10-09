import {object} from './required-call-recording.ts';
const units:Record<string,number>={zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90};
export function spokenMoneyAmounts(text:string){
 const found:number[]=[];
 // Match whole number words: "seven" must never consume "seventy".
 const words=Object.keys(units).concat('hundred','thousand','million','billion').join('|');
 const wordNumber=`(?:${words})\\b(?:[ -]+(?:and[ -]+)?(?:${words})\\b)*`;
 const amount=`(?:\\d+(?:,\\d{3})*(?:\\.\\d{1,2})?|${wordNumber})`;
 const number=(raw:string)=>{
  if(/^\d/.test(raw))return Number(raw.replaceAll(',',''));
  let total=0,group=0;
  for(const word of raw.toLowerCase().split(/[ -]+/).filter(t=>t!=='and')){
   if(word==='hundred')group=(group||1)*100;
   else if(['thousand','million','billion'].includes(word)){total+=(group||1)*({thousand:1000,million:1000000,billion:1000000000}[word]!);group=0;}
   else group+=units[word]??0;
  }
  return total+group;
 };
 // Consume explicit dollar/cents phrases together so the cents are neither
 // dropped nor treated as a second, conflicting dollar amount.
 let remaining=text.replace(new RegExp(`\\b(${amount})\\s+dollars?\\s+(?:and\\s+)?(${amount})\\s+cents?\\b`,'gi'),(match,dollars:string,cents:string)=>{
  const d=number(dollars),c=number(cents),value=d*100+c;
  if(Number.isSafeInteger(d)&&Number.isInteger(c)&&c>=0&&c<100&&Number.isSafeInteger(value))found.push(value);
  return ' '.repeat(match.length);
 });
 remaining=remaining.replace(new RegExp(`\\b(${amount})\\s+(dollars?|cents?)\\b`,'gi'),(match,raw:string,unit:string)=>{
  const n=number(raw),value=/^cent/i.test(unit)?n:Math.round(n*100);
  if(Number.isSafeInteger(value))found.push(value);
  return ' '.repeat(match.length);
 });
 for(const m of remaining.matchAll(/\$?\b(\d+(?:,\d{3})*(?:\.\d{1,2})?)\s*(k\b|thousand\b|million\b)?/gi)){
  const value=Math.round(Number(m[1].replaceAll(',',''))*(m[2]?.toLowerCase()==='million'?1000000:m[2]?1000:1)*100);if(Number.isSafeInteger(value))found.push(value);
 }
 for(const m of remaining.matchAll(new RegExp(`\\b${wordNumber}`,'gi'))){
  if(!/\b(hundred|thousand|million|billion)\b/i.test(m[0]))continue;
  const value=number(m[0])*100;if(Number.isSafeInteger(value))found.push(value);
 }
 return [...new Set(found)];
}
/** Provider transcript is evidence, never instructions. Require the whole latest
 * seller statement so a model cannot remove a negation or invent repair dollars. */
export function callOfferEvidence(value:unknown,input:Record<string,unknown>){
 const rows=object(value).transcript;if(!Array.isArray(rows))return false;
 let applicable=rows;
 if(input.action==='accept_offer'&&typeof input.quoteRevision==='string'){
  let lastQuote=-1;
  for(let n=0;n<rows.length;n++)for(const result of Array.isArray(object(rows[n]).tool_results)?object(rows[n]).tool_results as unknown[]:[]){
   const r=object(result);if(r.tool_name!=='icash_offer_and_contract'||r.is_error===true||typeof r.result_value!=='string')continue;
   let quote:Record<string,unknown>;try{quote=object(JSON.parse(r.result_value));}catch{continue;}
   if(quote.quoteAllowed===true&&typeof quote.quoteRevision==='string'){
    if(quote.quoteRevision!==input.quoteRevision||quote.priceCents!==input.priceCents)lastQuote=-2;else lastQuote=n;
   }
  }
  if(lastQuote===-2)return false;if(lastQuote>=0)applicable=rows.slice(lastQuote+1);
 }
 const turns=applicable.map(object).filter(t=>['user','agent'].includes(String(t.role))&&typeof t.message==='string');
 const index=turns.findLastIndex(t=>t.role==='user');if(index<0)return false;
 const latest=String(turns[index].message).trim();
 if(input.action==='accept_offer'){
  const yes=(text:string)=>/^(?:yes|yeah|yep|correct|i agree|i accept|that works|sounds good|i['’]?m ready|i am ready|let['’]?s do it)\b/i.test(text)&&!/\b(?:not|but|unless|if|different|instead)\b/i.test(text);
  const priceQuestion=(text:string)=>/\b(?:offer|cash|purchase|price|proceed)\b/i.test(text)&&spokenMoneyAmounts(text).includes(Number(input.priceCents));
  // A later name/date answer must not erase an earlier explicit price answer.
  // A counteroffer, condition or withdrawal after it does invalidate it.
  let accepted=false;
  for(let n=0;n<turns.length;n++){
   const turn=turns[n],text=String(turn.message).trim();if(turn.role!=='user')continue;
   let agent=turns.slice(0,n).findLast(t=>t.role==='agent');
   if(agent&&/are you still there|can you hear me/i.test(String(agent.message))&&/\b(?:let['’]?s do it|i accept|i agree|that works)\b/i.test(text)){
    const last=turns.lastIndexOf(agent);agent=turns.slice(0,last).findLast(t=>t.role==='agent');
   }
   if(agent&&priceQuestion(String(agent.message)))accepted=yes(text)&&!spokenMoneyAmounts(text).some(amount=>amount!==Number(input.priceCents));
   else if(/\b(?:only if|changed my mind|do not accept|don['’]?t accept|not selling|don['’]?t want to sell|no longer interested|cancel|hold off|not ready|wait|need to think|never agreed|didn['’]?t agree|did not agree|not sure|let me think)\b/i.test(text)||/\b(?:need|want|have)\b.{0,60}\b(?:spouse|wife|husband|partner|co[- ]?owner|attorney|lawyer)\b.{0,40}\b(?:agree|approval|approve|review|first|permission)\b/i.test(text)||/\b(?:offer|price|instead|but|unless)\b/i.test(text)||spokenMoneyAmounts(text).some(amount=>amount!==Number(input.priceCents))&&/\b(?:could you|can you|need|want|at least|only accept)\b/i.test(text))accepted=false;
  }
  return accepted;
 }
 if(latest!==String(input.sellerStatement??'').trim())return false;
 if(input.repairEstimateCents===undefined)return true;
 if(/\b(?:not|no idea|don['’]?t know|between|or|under|over|instead|maybe)\b/i.test(latest))return false;
 const amounts=spokenMoneyAmounts(latest),previous=turns.slice(0,index).findLast(t=>t.role==='agent');
 const repairs=/\b(?:repair|rehab|renovat|work|fix|budget)/i.test(latest+' '+String(previous?.message??''));
 return repairs&&amounts.length===1&&amounts[0]===input.repairEstimateCents;
}

/** A short balance answer needs the preceding payoff question to establish its
 * meaning. Matching a number alone must not turn an ownership change into debt. */
export function callPayoffEvidence(value:unknown,input:Record<string,unknown>){
 if(input.action!=='report_change'||!callOfferEvidence(value,input))return false;
 const rows=object(value).transcript;if(!Array.isArray(rows))return false;
 const turns=rows.map(object).filter(t=>['user','agent'].includes(String(t.role))&&typeof t.message==='string');
 const index=turns.findLastIndex(t=>t.role==='user');
 const latest=String(turns[index]?.message??''),previous=String(turns.slice(0,index).findLast(t=>t.role==='agent')?.message??'');
 const debtQuestion=/\b(mortgage|payoff|loan|heloc|debts?|liens?|taxes|hoa|owe)\b/i.test(previous);
 const coverageQuestion=/\b(cover|bring|pay)\b/i.test(previous)&&/\b(difference|shortfall|out of pocket|closing)\b/i.test(previous);
 if(!debtQuestion&&!coverageQuestion)return false;
 if(/\b(owner|owners|ownership|buyer|deed|title|inherited|divorce|repair|repairs|roof|condition|foundation|damage|offer|price|address|property|properties)\b/i.test(latest))return false;
 // An unclear answer to a debt question stays an unresolved debt question.
 // Only sellerPayoffEvidence can supply amounts or clear that pending state.
 return true;
}

/** Model summaries are not evidence. Bind material updates to the complete latest
 * caller turn, preserving negations and amounts before the ordinary validators. */
export function callSellerStatement(value:unknown,input:Record<string,unknown>):string|null{
 if(!['update_repairs','report_change'].includes(String(input.action)))return null;
 const rows=object(value).transcript;if(!Array.isArray(rows))return null;
 const turns=rows.map(object).filter(t=>['user','agent'].includes(String(t.role))&&typeof t.message==='string');
 const index=turns.findLastIndex(t=>t.role==='user');if(index<0)return null;
 const latest=String(turns[index].message).trim();if(!latest||latest.length>1000)return null;
 if(input.action==='update_repairs'){
  const previous=String(turns.slice(0,index).findLast(t=>t.role==='agent')?.message??'');
  if(!/\b(repair|repairs|roof|foundation|renovation|rehab|ac|air condition|hvac|plumbing|electrical|damage|condition|fix|budget)\b/i.test(latest+' '+previous))return null;
 }
 return latest;
}

/** An exact, unconditional seller asking price can seed a fresh proposal. It
 * never becomes acceptance until the server quotes it and the seller confirms. */
export function callSellerPriceEvidence(value:unknown,input:Record<string,unknown>):number|null{
 if(input.action!=='report_change'||!callOfferEvidence(value,input))return null;
 const text=String(input.sellerStatement??'').trim(),amounts=spokenMoneyAmounts(text);
 if(amounts.length!==1||amounts[0]<=0||/\b(not|no|but|if|unless|maybe|between|at least|more than|less than|mortgage|owe|repair|tax|lien|deposit|net|after fees)\b/i.test(text))return null;
 const prefix=/^(?:my asking price is|i am asking|i['’]m asking|i would (?:take|accept)|i['’]d (?:take|accept)|i can (?:take|accept)|i will (?:take|accept)|i['’]ll (?:take|accept))\s+/i.exec(text);
 if(!prefix)return null;
 const rest=text.slice(prefix[0].length).replace(/[.!]+$/,'').trim();
 const words=Object.keys(units).concat('hundred','thousand','million','and').join('|');
 const moneyOnly=new RegExp(`^(?:\\$?\\d[\\d,]*(?:\\.\\d{1,2})?\\s*(?:k|thousand|million)?(?: dollars?)?|(?:${words})(?:[ -]+(?:${words}))*(?: dollars?)?)$`,'i');
 if(!moneyOnly.test(rest))return null;
 return amounts[0];
}
