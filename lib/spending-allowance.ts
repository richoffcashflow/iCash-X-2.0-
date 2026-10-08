export type SpendingAllowanceData={day:string;limitCents:number;spentCents:number;reservedCents:number;remainingCents:number;availableCents:number;extraCents:number;resetsAt:string};
export type AllowanceIncrease={day:string;extraTotalCents:number};
export function validSpendingAllowance(value:unknown):value is SpendingAllowanceData{
 if(!value||typeof value!=='object')return false;
 const d=value as Record<string,unknown>;
 return typeof d.day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d.day)
  &&typeof d.resetsAt==='string'&&Number.isFinite(Date.parse(d.resetsAt))
  &&['limitCents','spentCents','reservedCents','remainingCents','availableCents','extraCents'].every(key=>Number.isSafeInteger(d[key])&&Number(d[key])>=0);
}
export function allowanceIncreaseConfirmed(value:unknown,request:AllowanceIncrease):value is SpendingAllowanceData{
 return validSpendingAllowance(value)&&value.day===request.day&&value.extraCents>=request.extraTotalCents;
}
export async function fetchSpendingAllowance(request?:AllowanceIncrease):Promise<SpendingAllowanceData>{
 const response=await fetch('/api/work/allowance',{
  method:request?'POST':'GET',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000),
  ...(request?{headers:{'Content-Type':'application/json'},body:JSON.stringify(request)}:{}),
 });
 const data:unknown=await response.json();
 if(!response.ok){
  const error=data&&typeof data==='object'&&'error' in data?data.error:null;
  throw Error(typeof error==='string'&&error.length<300?error:'Could not confirm today’s allowance. Please refresh and try again.');
 }
 if(!validSpendingAllowance(data)||request&&!allowanceIncreaseConfirmed(data,request))throw Error('The allowance increase was not confirmed. Please refresh and try again.');
 return data;
}
/** A timed-out POST may have saved. Read it back before inviting another submit. */
export async function saveSpendingAllowance(request:AllowanceIncrease):Promise<SpendingAllowanceData>{
 try{return await fetchSpendingAllowance(request);}
 catch(error){
  const saved=await fetchSpendingAllowance().catch(()=>null);
  if(allowanceIncreaseConfirmed(saved,request))return saved;
  throw error;
 }
}
