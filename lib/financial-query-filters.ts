type Filter=Record<string,unknown>;
const same=(a:unknown,b:unknown):boolean=>JSON.stringify(a)===JSON.stringify(b);
const lower=(f:Filter)=>['greater_than','greater_than_or_equal'].includes(String(f.operator))&&typeof f.value==='number'&&Number.isFinite(f.value);
/** One provider filter per field, preserving the conjunction of reviewed rules.
 * Unsupported or empty intersections stay unavailable; never drop a constraint. */
export function combineFinancialFilters(filters:Filter[]):Filter[]|null{
 const result:Filter[]=[];
 for(const f of filters){
  const index=result.findIndex(existing=>existing.filter_id===f.filter_id);
  if(index<0){result.push({...f});continue;}
  const previous=result[index];
  if(previous.operator===f.operator&&same(previous.value,f.value))continue;
  if(lower(previous)&&lower(f)){
   if(Number(f.value)>Number(previous.value)||f.value===previous.value&&f.operator==='greater_than')result[index]={...f};
   continue;
  }
  if(previous.filter_id==='last_sale_date'){
   if(previous.operator==='is_before'&&f.operator==='is_before'&&typeof previous.value==='string'&&typeof f.value==='string'){
    result[index]={...previous,value:previous.value<f.value?previous.value:f.value};continue;
   }
   const range=previous.operator==='date_range'?previous:f.operator==='date_range'?f:null;
   const before=previous.operator==='is_before'?previous:f.operator==='is_before'?f:null;
   if(range&&before&&typeof before.value==='string'){
    const bounds=range.value as {start?:unknown;end?:unknown};
    if(typeof bounds?.start!=='string'||typeof bounds.end!=='string')return null;
    const cutoff=new Date(before.value+'T00:00:00.000Z');if(!Number.isFinite(cutoff.getTime()))return null;
    cutoff.setUTCDate(cutoff.getUTCDate()-1);const last=cutoff.toISOString().slice(0,10),end=bounds.end<last?bounds.end:last;
    if(bounds.start>end)return null;
    result[index]={...range,value:{start:bounds.start,end}};continue;
   }
  }
  const range=previous.operator==='range'?previous:f.operator==='range'?f:null;
  const bound=lower(previous)?previous:lower(f)?f:null;
  if(range&&bound){
   const value=range.value as {min?:unknown;max?:unknown};
   if(typeof value?.min!=='number'||typeof value.max!=='number'||!Number.isFinite(value.min)||!Number.isFinite(value.max))return null;
   // An inclusive range cannot represent a strict lower bound inside the range.
   // Keep that experiment unavailable instead of weakening its financial floor.
   if(bound.operator==='greater_than'&&value.min<=Number(bound.value))return null;
   const min=Math.max(value.min,Number(bound.value));if(min>value.max)return null;
   result[index]={...range,value:{min,max:value.max}};continue;
  }
  return null;
 }
 return result;
}
