import {object} from './required-call-recording.ts';

function otherOwnerQuestion(message:string){
 const question=(message.match(/[^.!?;\n]+[.!?;]?/g)??[]).map(part=>part.trim()).filter(Boolean).at(-1)??'';
 return /^(?:does (?:anyone|anybody) else own (?:the|this|your) (?:property|house|home)(?: with you)?(?: who (?:would )?needs? to agree to sell)?|are there (?:any )?other owners(?: (?:of|on) (?:the|this|your) (?:property|house|home))?(?: who (?:would )?needs? to agree (?:to sell|to the sale))?)\?$/i.test(question);
}

const negativeAnswer=/^(?:(?:um|uh|well)[,.\s]+)*(?:no|nope)(?:[,.\s]+(?:um|uh|well|no|nope))*[.\s]*$/i;

/** A routine negative co-owner answer is not a newly reported material change.
 * This does not verify ownership or signers, clear an existing hold, or replace
 * agreement confirmation. The call route supplies the bound real transcript. */
export function sellerRoutineOwnershipAnswer(value:unknown,input:Record<string,unknown>):boolean{
 if(input.action!=='report_change')return false;
 const rows=object(value).transcript;if(!Array.isArray(rows))return false;
 const turns=rows.map(object).filter(t=>['user','agent'].includes(String(t.role))&&typeof t.message==='string');
 const index=turns.findLastIndex(t=>t.role==='user');if(index<1)return false;
 const answer=String(turns[index].message).trim();
 if(answer!==String(input.sellerStatement??'').trim()
  ||!negativeAnswer.test(answer))return false;
 const question=String(turns.slice(0,index).findLast(t=>t.role==='agent')?.message??'');
 if(!otherOwnerQuestion(question))return false;
 // A denial after a reported co-owner is a correction, not this narrow case.
 for(let n=0;n<index;n++)if(turns[n].role==='user'){
  const text=String(turns[n].message),prior=String(turns.slice(0,n).findLast(t=>t.role==='agent')?.message??'');
  if(otherOwnerQuestion(prior)&&!negativeAnswer.test(text.trim()))return false;
  if(/\b(?:another owner|co[- ]?owner|(?:wife|husband|spouse|partner|sister|brother).{0,30}\bowns?)\b/i.test(text))return false;
 }
 return true;
}
