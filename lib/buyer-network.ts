import {z} from 'zod';

export const networkConsentVersion='buyer-network-2026-10-10.1';
export const networkConsentText='I request off-market property packages by email from HomeOffer Network and participating iCash X members for properties matching my preferences, up to my selected daily limit. My name and email may be shared with those members for these deals. I can stop network emails at any time. Joining is free and does not authorize calls or texts.';
export const networkProfileSchema=z.object({
 name:z.string().trim().min(2).max(100),
 zips:z.array(z.string().regex(/^\d{5}$/)).min(1).max(20).transform(v=>[...new Set(v)]),
 propertyTypes:z.array(z.enum(['house','land'])).min(1).max(2).transform(v=>[...new Set(v)]),
 maxPriceCents:z.number().int().min(100000).max(10000000000),
 maxRepairsCents:z.number().int().min(0).max(10000000000),
 dailyEmails:z.number().int().min(1).max(3),
 accepted:z.literal(true),consentVersion:z.literal(networkConsentVersion),
}).strict();
export type NetworkProfile={name:string;email:string;zips:string[];propertyTypes:('house'|'land')[];maxPriceCents:number;maxRepairsCents:number;dailyEmails:number;paused:boolean;expiresAt:string};
export type NetworkMatch={id:string;state:'matched'|'interested'|'replied';address:string;askingPriceCents:number;url:string;createdAt:string};
export type NetworkWorkspace={vip:boolean;enrolledBuyers:number;settings:{enabled:boolean;mailingAddress:string}|null;matches:number;emailed:number;interested:number;responses:number;buyers:{id:string;dealId:string;name:string;email:string;address:string;respondedAt:string;state:'interested'|'replied';reply:string|null}[]};
export function networkError(error:unknown){
 if(error instanceof z.ZodError||error instanceof SyntaxError)return {status:400,error:'Check the ZIP codes, budget and required fields.'};
 if(error instanceof Error&&error.message==='SIGN_IN_REQUIRED')return {status:401,error:'Verify your email to continue.'};
 if(error instanceof Error&&error.message==='VIP_REQUIRED')return {status:403,error:'An active VIP membership is required.'};
 return {status:409,error:'Could not save this change. Refresh and try again.'};
}
