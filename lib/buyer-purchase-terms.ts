/** Standing policy for new buyer agreements. Never rewrite an issued agreement. */
export function buyerDepositCents(assignmentFeeCents:number){
 if(!Number.isSafeInteger(assignmentFeeCents)||assignmentFeeCents<0||assignmentFeeCents>100_000_000_000)throw Error('Valid assignment fee required');
 return Math.min(Math.round(assignmentFeeCents/5),500_000);
}
export const buyerDepositMethods=['check','wire','cash_app','zelle'] as const;
export const buyerDepositMethodLabels:Record<typeof buyerDepositMethods[number],string>={check:'Check',wire:'Wire',cash_app:'Cash App',zelle:'Zelle'};
export type SellerViewingSlot={startsAt:string;endsAt:string|null;timezone:string};
/** Public output contains only validated dates, never raw seller messages. */
export function sellerViewingSlots(value:unknown,now=Date.now()):SellerViewingSlot[]{
 if(!Array.isArray(value))return [];
 return value.slice(0,8).flatMap(v=>{
  if(!v||typeof v!=='object'||typeof v.startsAt!=='string'||typeof v.timezone!=='string')return [];
  const start=Date.parse(v.startsAt),end=v.endsAt===null?null:Date.parse(v.endsAt);
  if(!Number.isFinite(start)||start<=now||start>now+90*86400000||(end!==null&&(!Number.isFinite(end)||end<=start||end-start>12*3600000)))return [];
  try{new Intl.DateTimeFormat('en-US',{timeZone:v.timezone}).format(start);}catch{return [];}
  return [{startsAt:new Date(start).toISOString(),endsAt:end===null?null:new Date(end).toISOString(),timezone:v.timezone}];
 });
}
export function viewingSlotLabel(slot:SellerViewingSlot){
 const format=new Intl.DateTimeFormat('en-US',{timeZone:slot.timezone,weekday:'long',month:'long',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true,timeZoneName:'short'});
 const end=slot.endsAt?new Intl.DateTimeFormat('en-US',{timeZone:slot.timezone,hour:'numeric',minute:'2-digit',hour12:true,timeZoneName:'short'}).format(new Date(slot.endsAt)):null;
 return format.format(new Date(slot.startsAt))+(end?' to '+end:'');
}
