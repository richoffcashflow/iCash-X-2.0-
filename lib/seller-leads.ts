import {z} from 'zod';
export const sellerBrand='HomeOffer Network';
export const sellerConsentVersion='homeoffer-seller-contact-2026-10-05.4';
export const sellerConsentText='I agree to marketing calls, texts and emails about my property from HomeOffer Network and its matched buyers, including automated texts and AI-generated voice calls. Consent is not a condition of buying or selling. Message/data rates may apply. Reply STOP to texts or unsubscribe from emails.';
export const sellerSharingText='HomeOffer Network connects sellers with independent property buyers. We may be paid for sharing your request. No offer or sale is guaranteed.';
const clean=(max:number)=>z.string().trim().min(1).max(max).regex(/^[^\u0000-\u001f<>]+$/u);
export function sellerPhone(v:string){const s=v.replace(/[\s().-]/g,'');const n=/^[2-9]\d{2}[2-9]\d{6}$/.test(s)?'+1'+s:/^1[2-9]\d{2}[2-9]\d{6}$/.test(s)?'+'+s:s;return /^\+1[2-9]\d{2}[2-9]\d{6}$/.test(n)?n:null;}
export const sellerSubmission=z.object({name:clean(100),address:clean(300),phone:z.string().max(30).transform(sellerPhone).refine((p):p is string=>p!==null,'Enter a valid US phone number.'),email:z.union([z.string().trim().email().max(254),z.literal('')]).optional().transform(v=>v?.toLowerCase()||null),consented:z.literal(true),consentVersion:z.literal(sellerConsentVersion),requestId:z.string().uuid(),campaign:z.string().max(100).regex(/^[a-zA-Z0-9_-]*$/).default(''),source:z.enum(['meta','google','tiktok','youtube','other','direct']).default('direct'),clickId:z.string().max(300).regex(/^[a-zA-Z0-9_.:-]*$/).default(''),honeypot:z.string().max(200).default('')}).strict();
export type SellerSubmission=z.infer<typeof sellerSubmission>;
export function sellerDuplicateKeyInput(address:string,phone:string){return address.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g,'')+'|'+phone;}
