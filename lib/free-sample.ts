/** Local arithmetic only. This does not price a real property or authorize an offer. */
export const sampleInputs={value:'220000',repairs:'25000',fee:'15000'};
export function sampleOffer(inputs:{value:string;repairs:string;fee:string}){
 const cents=(value:string)=>/^\d+(?:\.\d{1,2})?$/.test(value.trim())&&Number(value)<=100_000_000?Math.round(Number(value)*100):null;
 const value=cents(inputs.value),repairs=cents(inputs.repairs),fee=cents(inputs.fee);
 if(value===null||repairs===null||fee===null||value<=0)return null;
 const buyerBudget=Math.floor(value*70/100)-repairs;
 return {buyerBudgetCents:buyerBudget,sellerCapCents:buyerBudget-fee,hasRoom:buyerBudget-fee>0};
}

/** Keep incomplete local drafts; validation belongs to the calculation, not restoration. */
export function restoreSampleInputs(value:unknown):typeof sampleInputs|null{
 if(!value||typeof value!=='object')return null;
 const draft=value as Record<string,unknown>;
 if(!['value','repairs','fee'].every(key=>typeof draft[key]==='string'&&(draft[key] as string).length<=24))return null;
 return {value:draft.value as string,repairs:draft.repairs as string,fee:draft.fee as string};
}
