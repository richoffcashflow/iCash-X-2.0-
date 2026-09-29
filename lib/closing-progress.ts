import {z} from 'zod';
export const closingKinds=['title_opened','deposit_received','closing_scheduled','closed'] as const;
export type ClosingKind=typeof closingKinds[number];
export type ClosingUpdate={id:string;kind:ClosingKind;effective_date:string|null;amount_cents:number|null;file_reference:string;reply_id:string;created_at:string};
export type ClosingReply={id:string;sender:string;subject:string;body_text:string;received_at:string};
export const closingLabels:Record<ClosingKind,string>={title_opened:'Title file opened',deposit_received:'Buyer deposit confirmed',closing_scheduled:'Closing scheduled',closed:'Closing completed'};
export const closingUpdateSchema=z.object({dealId:z.string().uuid(),replyId:z.string().uuid(),kind:z.enum(closingKinds),confirmed:z.literal(true),effectiveDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),amountCents:z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),fileReference:z.string().trim().max(120)}).strict().superRefine((v,c)=>{
 if(v.kind==='deposit_received'&&v.amountCents===null)c.addIssue({code:z.ZodIssueCode.custom,message:'Enter the amount confirmed by title.'});
 if((v.kind==='closing_scheduled'||v.kind==='closed')&&!v.effectiveDate)c.addIssue({code:z.ZodIssueCode.custom,message:'Enter the date confirmed by title.'});
 if(v.effectiveDate){const d=new Date(v.effectiveDate+'T12:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==v.effectiveDate)c.addIssue({code:z.ZodIssueCode.custom,message:'Enter a valid date.'});}
});
export function closingSummary(updates:ClosingUpdate[]){
 const latest=(kind:ClosingKind)=>updates.find(u=>u.kind===kind);
 if(latest('closed'))return {label:'Closing completed',next:'Review your closing statement for your fee and payment timing.'};
 if(latest('closing_scheduled'))return {label:'Closing scheduled',next:`Confirm signing arrangements with your closer. Scheduled date: ${latest('closing_scheduled')!.effective_date}.`};
 if(latest('deposit_received'))return {label:'Buyer deposit confirmed',next:'Title is preparing the remaining documents and closing date.'};
 if(latest('title_opened'))return {label:'Title file opened',next:'The closing office is checking ownership, liens and required documents.'};
 return {label:'Waiting for title confirmation',next:'A sent request does not mean the file is open. Updates appear after the closing office confirms them.'};
}
