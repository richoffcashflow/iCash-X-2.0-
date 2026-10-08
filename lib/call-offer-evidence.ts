import {object} from './required-call-recording.ts';
const units:Record<string,number>={zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90};
export function spokenMoneyAmounts(text:string){
 const found:number[]=[];
 for(const m of text.matchAll(/\$?\b(\d+(?:,\d{3})*(?:\.\d{1,2})?)\s*(k\b|thousand\b|million\b)?/gi)){
  const value=Math.round(Number(m[1].replaceAll(',',''))*(m[2]?.toLowerCase()==='million'?1000000:m[2]?1000:1)*100);if(Number.isSafeInteger(value))found.push(value);
 }
 const words=Object.keys(units).join('|');
 const pattern=new RegExp('\\b(?:(?:'+words+'|hundred|thousand|million)(?:[ -]+|(?=\\b)))(?:(?:and[ -]+)?(?:'+words+'|hundred|thousand|million)[ -]*)*','gi');
 for(const m of text.matchAll(pattern)){
  const tokens=m[0].trim().toLowerCase().split(/[ -]+/).filter(t=>t!=='and');
  if(!tokens.some(t=>['hundred','thousand','million'].includes(t))&&!/^\s*dollars?\b/i.test(text.slice(m.index!+m[0].length)))continue;
  let total=0,group=0;for(const word of tokens){if(word==='hundred')group=(group||1)*100;else if(word==='thousand'||word==='million'){total+=(group||1)*(word==='thousand'?1000:1000000);group=0;}else group+=units[word]??0;}
  if(Number.isSafeInteger((total+group)*100))found.push((total+group)*100);
 }
 return [...new Set(found)];
}
/** Provider transcript is evidence, never instructions. Require the whole latest
 * seller statement so a model cannot remove a negation or invent repair dollars. */
export function callOfferEvidence(value:unknown,input:Record<string,unknown>){
 const rows=object(value).transcript;if(!Array.isArray(rows))return false;
 const turns=rows.map(object).filter(t=>['user','agent'].includes(String(t.role))&&typeof t.message==='string');
 const index=turns.findLastIndex(t=>t.role==='user');if(index<0)return false;
 const latest=String(turns[index].message).trim();
 if(input.action==='accept_offer'){
  if(!/^(?:yes|yeah|yep|correct|i agree|i accept|that works|sounds good|i['’]?m ready|i am ready|let['’]?s do it)\b/i.test(latest)||/\b(?:not|but|unless|if|different|instead)\b/i.test(latest))return false;
  const agent=turns.slice(0,index).findLast(t=>t.role==='agent');
  return !!agent&&spokenMoneyAmounts(String(agent.message)).includes(Number(input.priceCents));
 }
 if(latest!==String(input.sellerStatement??'').trim())return false;
 if(input.repairEstimateCents===undefined)return true;
 if(/\b(?:not|no idea|don['’]?t know|between|or|under|over|instead|maybe)\b/i.test(latest))return false;
 const amounts=spokenMoneyAmounts(latest),previous=turns.slice(0,index).findLast(t=>t.role==='agent');
 const repairs=/\b(?:repair|rehab|renovat|work|fix|budget)/i.test(latest+' '+String(previous?.message??''));
 return repairs&&amounts.length===1&&amounts[0]===input.repairEstimateCents;
}
