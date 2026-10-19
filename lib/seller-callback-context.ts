import {z} from 'zod';
export const callbackBusinessNumbers=['+14243948384','+17208134296','+14244377030'] as const;
export function callbackPhone(value:string){const digits=value.replace(/[() .+-]/g,'');const phone=digits.length===10?'+1'+digits:'+'+digits;return /^\+1[2-9]\d{9}$/.test(phone)?phone:null;}
const phone=z.string().regex(/^\+1[2-9]\d{9}$/);
const report=z.object({phone,businessNumber:phone.nullable(),status:z.enum(['unknown','matched','ambiguous']),matches:z.array(z.object({account:z.string().min(1),accountId:z.string().uuid(),address:z.string().min(1),screeningId:z.string().uuid(),businessNumber:phone,lastContactAt:z.string().refine(v=>Number.isFinite(Date.parse(v))),available:z.boolean()})).max(51)});
export type SellerCallbackContext=z.infer<typeof report>;
export function validSellerCallbackContext(value:unknown,caller:string,business:string|null):value is SellerCallbackContext{
 const parsed=report.safeParse(value);if(!parsed.success)return false;const r=parsed.data;
 return r.phone===caller&&r.businessNumber===business&&r.status===(r.matches.length===0?'unknown':r.matches.length===1?'matched':'ambiguous')&&r.matches.every(m=>business===null||m.businessNumber===business);
}
