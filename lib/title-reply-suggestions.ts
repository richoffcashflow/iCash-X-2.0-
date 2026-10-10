import type {ClosingKind,ClosingReply} from './closing-progress';
export type TitleSuggestion={replyId:string;kind:ClosingKind;evidence:string;effectiveDate:string|null;amountCents:number|null;fileReference:string};
const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
function exactDate(text:string){
 const dates=[...text.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map(m=>m[1]);
 for(const m of text.matchAll(/\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(\d{4})\b/gi))dates.push(`${m[3]}-${String(months.indexOf(m[1].slice(0,3).toLowerCase())+1).padStart(2,'0')}-${m[2].padStart(2,'0')}`);
 const unique=[...new Set(dates)];if(unique.length!==1)return null;
 const date=new Date(unique[0]+'T12:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===unique[0]?unique[0]:null;
}
/** Deterministic suggestions only. No model call and no automatic financial/status mutation. */
export function titleReplySuggestions(reply:ClosingReply):TitleSuggestion[]{
 const lines:string[]=[];
 for(const line of reply.body_text.slice(0,16000).split(/\r?\n/)){
  if(/^\s*(?:>|On .+wrote:|From:|Sent:|[-_]{3,}|--\s*$|Begin forwarded message:)/i.test(line))break;
  lines.push(line);
 }
 const result:TitleSuggestion[]=[];
 for(const sentence of lines.join('\n').split(/\n|(?<=[.!?])\s+/)){
  const text=sentence.trim();if(!text||/[?]/.test(text)||/\b(?:not|no|never|pending|awaiting|waiting|if|once|will|would|should|could|expect|expected|anticipate|proposed|tentative|cancelled|canceled|delayed|unable|cannot|hasn't|haven't|isn't)\b/i.test(text))continue;
  let kind:ClosingKind|null=null;
  if(/\b(?:proceeds|funds|payment)\b.{0,35}\b(?:sent|disbursed|wired)\b|\b(?:sent|disbursed|wired)\b.{0,35}\b(?:proceeds|funds|payment)\b/i.test(text))kind='funds_disbursed';
  else if(/\b(?:deposit|earnest money|EMD)\b.{0,35}\b(?:received|cleared)\b|\b(?:received|cleared)\b.{0,35}\b(?:deposit|earnest money|EMD)\b/i.test(text))kind='deposit_received';
  else if(/\bclosing\s+(?:is |has been |was )?(?:scheduled|set|confirmed)\b/i.test(text))kind='closing_scheduled';
  else if(/\b(?:closing|transaction|deal)\s+(?:is |has |has been |was )?(?:closed|completed|complete)\b|\bwe (?:have )?closed\b/i.test(text))kind='closed';
  else if(/\b(?:title )?file\s+(?:is |has been |was )?(?:open|opened)\b|\bwe (?:have )?opened (?:the |your |a )?(?:title )?file\b/i.test(text))kind='title_opened';
  if(!kind||result.some(s=>s.kind===kind))continue;
  const amounts=[...text.matchAll(/\$\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{2})?)(?!\d|[.,]\d)/g)];
  const cents=amounts.length===1?Math.round(Number(amounts[0][1].replaceAll(',',''))*100):null;
  const reference=text.match(/\b(?:file|payment|wire|check|transaction)\s*(?:number|reference|ref\.?|#|no\.?)?\s*[:#]\s*([a-z0-9][a-z0-9_-]{1,119})\b/i)?.[1]??'';
  result.push({replyId:reply.id,kind,evidence:text.slice(0,1000),effectiveDate:exactDate(text),amountCents:cents!==null&&Number.isSafeInteger(cents)&&cents>0?cents:null,fileReference:reference});
 }
 return result;
}
