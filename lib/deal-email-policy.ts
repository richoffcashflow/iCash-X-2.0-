import {z} from 'zod';
export const dealEmailSchema=z.object({dealId:z.string().uuid(),contactKey:z.string().min(1).max(100),requestKey:z.string().uuid(),rateId:z.string().uuid(),subject:z.string().trim().min(1).max(180).refine(v=>!/[\r\n]/.test(v)&&!v.toUpperCase().includes('[ICX-')),message:z.string().trim().min(1).max(10000)}).strict();
export function emailSendLabel(state:string){return state==='accepted'?'Accepted for delivery':state==='received'?'Received':state==='needs_review'||state==='dispatching'?'Delivery needs review':'Not sent';}
export function emailFromName(principal:string){return principal.replace(/[<>"\r\n]/g,'').trim().slice(0,80)||'Your contact';}
