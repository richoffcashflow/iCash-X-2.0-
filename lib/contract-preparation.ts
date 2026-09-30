import type {DealTerms} from './deal-documents.ts';
export type TermMessage={id:string;party:'seller'|'buyer';body:string;partyKey?:string};
type Field='seller'|'assignee'|'priceCents'|'assignmentDepositCents'|'closingDate';
/** A prior affirmative price statement cannot survive a later refusal merely because its amount still matches. */
function rejectsPrice(body:string){
 return /\b(?:(?:won['’]t|wouldn['’]t|can['’]t|cannot|couldn['’]t|don['’]t|do not|will not|would not|could not|not|never)\s+(?:accept|agree|sell)|(?:reject|decline|rejecting|declining|rejected|declined)\s+(?:(?:that|the|your|this)\s+)?(?:offer|price|amount|\$))/i.test(body);
}
/** Narrow extraction for draft assistance only. Never sets agreement, ownership or signing authority. */
export function contractPreparation(messages:TermMessage[],stage:string,current:DealTerms){
 const found=new Map<Field,{value:string|number;quote:string;sourceId:string}[]>();
 const add=(key:Field,value:string|number,m:TermMessage)=>{const a=found.get(key)??[];a.push({value,quote:m.body,sourceId:m.id});found.set(key,a);};
 for(const m of messages.slice(-150)){
  const body=m.body.trim();if(body.length>1000)continue;
  const name=/^my (?:full legal |legal )name is ([\p{L}][\p{L} .’'-]{1,120})[.!]?$/iu.exec(body);
  if(name)add(m.party==='seller'?'seller':'assignee',name[1].replace(/[.!]+$/,'').trim(),m);
  const price=/^(?:i agree to sell (?:it |the property )?for|i will sell (?:it |the property )?for|i accept) \$((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)[.!]?$/i.exec(body);
  if(price&&m.party==='seller'){const cents=Math.round(Number(price[1].replaceAll(',',''))*100);if(Number.isSafeInteger(cents)&&cents>0&&cents<=100000000000)add('priceCents',cents,m);}
  const deposit=/^i agree to (?:a |the )(?:non[- ]refundable )?deposit of \$((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)[.!]?$/i.exec(body);
  if(deposit&&m.party==='buyer'){const cents=Math.round(Number(deposit[1].replaceAll(',',''))*100);if(Number.isSafeInteger(cents)&&cents>0&&cents<=100000000000)add('assignmentDepositCents',cents,m);}
  const date=/^i agree to clos(?:e|ing) (?:on )?(\d{4}-\d{2}-\d{2})[.!]?$/i.exec(body);
  if(date&&m.party==='seller'&&!Number.isNaN(Date.parse(date[1]))&&new Date(date[1]).toISOString().slice(0,10)===date[1])add('closingDate',date[1],m);
 }
 const patch:Partial<DealTerms>={},evidence:{field:Field;quote:string;sourceId:string}[]=[],conflicts:Field[]=[];
 for(const [field,values] of found){
  const party=['assignee','assignmentDepositCents'].includes(field)?'buyer':'seller';
  const partyMessages=messages.filter(m=>m.party===party);
  if(new Set(partyMessages.map(m=>m.partyKey??'unspecified')).size>1||partyMessages.some(m=>/\b(cancel|withdraw|changed my mind|no longer|not selling|backing out|don.t agree)\b/i.test(m.body))){conflicts.push(field);continue;}
  if(field==='priceCents'&&partyMessages.some(m=>rejectsPrice(m.body))){conflicts.push(field);continue;}
  if(stage!=='draft'&&!['assignee','assignmentDepositCents'].includes(field))continue;
  if(!['draft','under_contract'].includes(stage))continue;
  if(new Set(values.map(v=>v.value)).size!==1){conflicts.push(field);continue;}
  if(current[field]!==null&&current[field]!=='')continue;
  const v=values.at(-1)!;Object.assign(patch,{[field]:v.value});evidence.push({field,quote:v.quote,sourceId:v.sourceId});
 }
 return {patch,evidence,conflicts,requiresReview:true as const};
}
/** Preserve customer edits made while the preparation request is in flight. */
export function fillEmptyTerms(current:DealTerms,patch:Partial<DealTerms>){
 const next={...current};for(const key of ['seller','assignee','priceCents','assignmentDepositCents','closingDate'] as const){
  if((next[key]===null||next[key]==='')&&patch[key]!==undefined)Object.assign(next,{[key]:patch[key]});
 }return next;
}
