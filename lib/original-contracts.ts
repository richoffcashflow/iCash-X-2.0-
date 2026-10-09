import forms from '../config/signing-templates/owner-originals.json' with {type:'json'};
import type {DealTerms} from './deal-documents.ts';
export const originalContractProfile='owner_original_20261009';
export type OriginalContractKind='purchase'|'assignment';
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const date=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)?`${s.slice(5,7)}/${s.slice(8,10)}/${s.slice(0,4)}`:s;
const dollars=(n:number|null)=>n===null?'':(n/100).toFixed(2);
/** Only the blanks in the owner's original forms. Never synthesize clauses or a county. */
export function originalContractValues(t:DealTerms,kind:OriginalContractKind):Record<string,string>{
 const address=t.address.match(/^(.+),\s*([^,]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i);
 const common={street:address?.[1].trim()??t.address,city:address?.[2].trim()??'',state:t.state,county:t.county??'',zip:address?.[4]??'',legalDescription:t.legalDescription,buyer:t.buyer};
 if(kind==='purchase')return {...common,seller:t.seller,sellerPrinted:t.seller,buyerPrinted:t.buyer,priceCents:dollars(t.priceCents),closingDate:date(t.closingDate)};
 return {...common,effectiveDate:date(t.effectiveDate),assignee:t.assignee,buyerRepeated:t.buyer,assignmentFeeCents:dollars(t.assignmentFeeCents),assignmentDepositCents:dollars(t.assignmentDepositCents)};
}
export function originalContractFieldMap(kind:OriginalContractKind){return forms[kind].fieldMap;}
export function originalContractFieldsForRole(kind:OriginalContractKind,role:string,values:Record<string,string>){
 return forms[kind].fields.filter(f=>f.type==='text'&&f.role===role).map(f=>{
  const value=values[f.name]??'',a=f.areas[0];
  const font=Math.min(f.preferences.font_size,Math.max(5,Math.floor((a.w*612-2)/(Math.max(1,value.length)*0.56))));
  return {name:f.name,default_value:value,readonly:true,preferences:{...f.preferences,font_size:font}};
 });
}
/** Preview and DocuSeal use the same original page and the same blank positions. */
export function renderOriginalContract(kind:OriginalContractKind,t:DealTerms){
 const form=forms[kind],values=originalContractValues(t,kind);
 const fields=form.fields.filter(f=>f.type==='text').map(f=>{
  const a=f.areas[0],value=values[f.name]??'';
  // Fit into the original blank without adding lines, clipping, or changing the form.
  const font=Math.min(f.preferences.font_size,Math.max(5,(a.w*form.width-2)/(Math.max(1,value.length)*0.56)));
  return `<span data-field="${escape(f.name)}" style="left:${a.x*100}%;top:${a.y*100}%;width:${a.w*100}%;height:${a.h*100}%;font-size:${font}pt">${escape(value)}</span>`;
 }).join('');
 return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(form.title)}</title><style>@page{size:letter;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff}.page{position:relative;width:612pt;height:792pt;font-family:Arial,sans-serif;color:#000}.page img{position:absolute;inset:0;width:100%;height:100%}.page span{position:absolute;display:flex;align-items:flex-end;white-space:nowrap;padding:0 1pt 1pt;line-height:1.1}@media print{.page{break-after:avoid}}</style></head><body><div class="page"><img alt="${escape(form.title)}" src="${form.background}">${fields}</div></body></html>`;
}
