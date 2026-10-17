import {z} from 'zod';
import {redactSupportQuestion} from './support-policy.ts';
export const accessHelpCookie='__Host-icash_access_help';
export const accessHelpInput=z.object({requestId:z.string().uuid(),email:z.string().trim().email().max(254),phone:z.string().max(40).optional(),message:z.string().trim().min(1).max(2000)}).strict();
export const accessHelpUpdate=z.object({id:z.string().uuid(),requestId:z.string().uuid(),status:z.enum(['open','waiting_on_customer','resolved']),reply:z.string().trim().min(1).max(3000).optional()}).strict();
export const accessHelpRedact=(text:string)=>redactSupportQuestion(text).replace(/\b\d{6,10}\b/g,'[code removed]').slice(0,2000);
export type AccessHelpConversation={id:string;email:string;phone:string|null;status:string;notification?:{status:string;delivery:string|null}|null;messages:{id:string;requestId:string;role:string;content:string;createdAt:string}[]};
