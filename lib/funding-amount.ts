export const customFundingCode='work_custom';
export const minimumFundingCents=1000;
export const maximumFundingCents=100000;
export function validFundingAmount(value:unknown):value is number{
 return typeof value==='number'&&Number.isSafeInteger(value)&&value>=minimumFundingCents&&value<=maximumFundingCents;
}
/** Parse money as decimal digits, never round a floating-point purchase amount. */
export function fundingAmountCents(value:string):number|null{
 const match=/^(\d{1,4})(?:\.(\d{1,2}))?$/.exec(value.trim());
 if(!match)return null;
 const cents=Number(match[1])*100+Number((match[2]??'').padEnd(2,'0'));
 return validFundingAmount(cents)?cents:null;
}
