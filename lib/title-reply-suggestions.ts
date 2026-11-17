import type {ClosingKind,ClosingReply} from './closing-progress';
export type TitleSuggestion={replyId:string;kind:ClosingKind;evidence:string;effectiveDate:string|null;amountCents:number|null;fileReference:string};
const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
function exactDate(text:string){
 const dates=[...text.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map(m=>m[1]);
 for(const m of text.matchAll(/\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(\d{4})\b/gi))dates.push(`${m[3]}-${String(months.indexOf(m[1].slice(0,3).toLowerCase())+1).padStart(2,'0')}-${m[2].padStart(2,'0')}`);
 const unique=[...new Set(dates)];if(unique.length!==1)return null;
 const date=new Date(unique[0]+'T12:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===unique[0]?unique[0]:null;
}
function milestone(text:string):ClosingKind|null{
 if(/\b(?:proceeds|funds|payment)\b.{0,35}\b(?:sent|disbursed|wired)\b|\b(?:sent|disbursed|wired)\b.{0,35}\b(?:proceeds|funds|payment)\b/i.test(text))return 'funds_disbursed';
 if(/\b(?:deposit|earnest money|EMD)\b.{0,35}\b(?:received|cleared)\b|\b(?:received|cleared)\b.{0,35}\b(?:deposit|earnest money|EMD)\b/i.test(text))return 'deposit_received';
 if(/\bclosing\s+(?:is |has been |was )?(?:scheduled|set|confirmed)\b/i.test(text))return 'closing_scheduled';
 if(/\b(?:closing|transaction|deal)\s+(?:is |has |has been |was )?(?:closed|completed|complete)\b|\bwe (?:have )?closed\b/i.test(text))return 'closed';
 if(/\b(?:title )?file\s+(?:is |has been |was )?(?:open|opened)\b|\bwe (?:have )?opened (?:the |your |a )?(?:title )?file\b/i.test(text))return 'title_opened';
 return null;
}
function sentences(text:string){
 const result:string[]=[];let start=0;
 for(const match of text.matchAll(/\n|(?<=[.!?])[^\S\n]+/g)){
  const end=match.index!;
  // A month abbreviation belongs to the same date and evidence sentence.
  if(match[0]!== '\n'&&/\b(?:Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.$/i.test(text.slice(start,end))
   &&/^\d{1,2}(?:st|nd|rd|th)?[,]?\s+\d{4}\b/i.test(text.slice(end+match[0].length)))continue;
  result.push(text.slice(start,end));start=end+match[0].length;
 }
 result.push(text.slice(start));return result;
}
const uncertainty=/\b(?:not|no|never|pending|awaiting|waiting|if|once|will|would|should|could|expect|expected|anticipate|proposed|tentative|cancelled|canceled|delayed|unable|cannot|hasn't|haven't|isn't|wasn't|weren't|aren't|didn't|doesn't|don't|won't|wouldn't|shouldn't|couldn't|can't|hadn't)\b/i;
const statusRequest=/\b(?:need|needs|require|requires)\s+to\s+(?:confirm|verify|check)\b|^(?:confirm|verify|check|advise|has|have|is|are|was|were)\b|\b(?:please|kindly)\s+(?:confirm|verify|check|advise|tell|let)\b|\b(?:please|kindly)\s+(?:provide|send)\s+(?:(?:your|a|written|final)\s+)*(?:confirmation|verification|proof|evidence)\b|\bcan\s+(?:you|someone|the|our|your|be)\b|\b(?:need|needs|require|requires|request|requesting|requested|seeking)\s+(?:(?:your|a|written|final)\s+)*(?:confirmation|verification|proof|evidence)\b/i;
const reversed=/\b(?:returned|reversed|recalled|rescinded|bounced|rejected|disregard|retracted|cancelled|canceled|delayed|withdrawn)\b/i;
const correction=/^(?:correction|corrected update)\s*[:—-]|\b(?:previous|earlier|last|that|this)\s+(?:statement|update|confirmation|message|information)\s+(?:was|is|has been)\s+(?:incorrect|inaccurate|mistaken|retracted)\b/i;
const precedingStatus=/^(?:it|this|that|they|those|these)\s+(?:is|are|was|were|has|have|had|will|would|can|could|may|might|isn't|aren't|wasn't|weren't|hasn't|haven't|hadn't|won't|wouldn't|can't|couldn't)\b/i;
function reversedKinds(text:string):ClosingKind[]{
 const kinds:ClosingKind[]=[];
 if(/\b(?:deposit|earnest money|EMD)\b/i.test(text))kinds.push('deposit_received');
 if(/\b(?:funds|proceeds|payment|wire)\b/i.test(text))kinds.push('funds_disbursed');
 if(/\b(?:closing|transaction|deal)\b/i.test(text))kinds.push('closing_scheduled','closed');
 if(/\b(?:title|file)\b/i.test(text))kinds.push('title_opened');
 return kinds;
}
/** Deterministic suggestions only. No model call and no automatic financial/status mutation. */
export function titleReplySuggestions(reply:ClosingReply):TitleSuggestion[]{
 // Do not suggest from a truncated source that may omit a later correction.
 if(reply.body_text.length>16000)return [];
 const lines:string[]=[];
 for(const line of reply.body_text.split(/\r?\n/)){
  if(/^\s*(?:>|On .+wrote:|From:|Sent:|[-_]{3,}|--\s*$|Begin forwarded message:)/i.test(line))break;
  lines.push(line);
 }
 const candidates:TitleSuggestion[]=[];const blocked=new Set<ClosingKind>();let previous:ClosingKind|null=null;
 for(const sentence of sentences(lines.join('\n'))){
  const text=sentence.trim();
  // Preserve exact source evidence. Requests, uncertainty and reversals cannot
  // prefill a positive milestone, including an earlier assertion in this reply.
  const meaning=text.replaceAll('’',"'");const kind=milestone(text);
  if(!text)continue;
  if(previous&&correction.test(meaning)&&(!kind||kind===previous))blocked.add(previous);
  if(/\b(?:changed|rescheduled|moved|corrected|postponed)\b/i.test(meaning)&&/\b(?:closing|date|schedule|amount|reference)\b/i.test(meaning)){
   const affected=reversedKinds(meaning);
   for(const value of affected)blocked.add(value);
   if(!affected.length&&previous)blocked.add(previous);
   previous=kind;continue;
  }
  if(text.length>1000){if(kind)blocked.add(kind);previous=kind;continue;}
  if(/[?]/.test(text)||uncertainty.test(meaning)||/\b(?:may|might)\b(?!\s+\d{1,2}\b)/i.test(meaning)||statusRequest.test(meaning)||reversed.test(meaning)){
   if(kind)blocked.add(kind);
   else if(previous&&precedingStatus.test(meaning))blocked.add(previous);
   if(reversed.test(meaning)){
    const affected=reversedKinds(meaning);
    for(const value of affected)blocked.add(value);
    if(!affected.length&&previous&&precedingStatus.test(meaning))blocked.add(previous);
   }
   previous=kind;continue;
  }
  previous=kind;if(!kind)continue;
  const amounts=[...text.matchAll(/\$\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{2})?)(?!\d|[.,]\d)/g)];
  const cents=amounts.length===1?Math.round(Number(amounts[0][1].replaceAll(',',''))*100):null;
  const reference=text.match(/\b(?:file|payment|wire|check|transaction)\s*(?:number|reference|ref\.?|#|no\.?)?\s*[:#]\s*([a-z0-9][a-z0-9_-]{1,119})\b/i)?.[1]??'';
  candidates.push({replyId:reply.id,kind,evidence:text,effectiveDate:exactDate(text),amountCents:cents!==null&&Number.isSafeInteger(cents)&&cents>0?cents:null,fileReference:reference});
 }
 const result:TitleSuggestion[]=[];
 for(const kind of new Set(candidates.map(s=>s.kind))){
  if(blocked.has(kind))continue;
  const matching=candidates.filter(s=>s.kind===kind);
  // A corrected date, amount or reference requires review of the full reply;
  // retaining the first assertion would prefill stale terms.
  if((['effectiveDate','amountCents','fileReference'] as const).some(key=>new Set(matching.map(s=>s[key]).filter(v=>v!==null&&v!=='')).size>1))continue;
  matching.sort((a,b)=>Number(!!b.effectiveDate)+Number(!!b.amountCents)+Number(!!b.fileReference)-Number(!!a.effectiveDate)-Number(!!a.amountCents)-Number(!!a.fileReference));
  result.push(matching[0]);
 }
 return result;
}
