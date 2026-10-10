import {isIP} from 'node:net';
import {db} from '@/lib/stripe-test';
import {finalSalePolicy,finalSaleVersion} from './final-sale-policy.ts';
export type Acceptance={kind:'membership'|'credits'|'vip'|'daily';reference:string;mode:'live'|'test';accountId:string|null;guestHash?:string|null;version:string;terms:string;amountCents:number};
export function purchaseContext(req:Request,env:NodeJS.ProcessEnv=process.env){
 // Only Vercel's overwritten platform header is trusted. Never use a client-supplied X-Forwarded-For.
 const candidate=env.VERCEL==='1'?req.headers.get('x-vercel-forwarded-for')?.trim():null;
 return {ip:candidate&&isIP(candidate)?candidate:null,userAgent:req.headers.get('user-agent')?.slice(0,512)??null,path:new URL(req.url).pathname};
}
export async function recordPurchaseAcceptance(req:Request,receipt:Acceptance){
 await db('rpc/icash_record_purchase_acceptance','POST',{p_kind:receipt.kind,p_reference:receipt.reference,p_mode:receipt.mode,p_account:receipt.accountId,p_guest:receipt.guestHash??null,p_version:receipt.version,p_terms:receipt.terms,p_amount:receipt.amountCents,p_policy_version:finalSaleVersion,p_policy:finalSalePolicy,p_context:purchaseContext(req)});
}
export async function recordSoftwareAccess(req:Request,accountId:string,userId:string){
 try{await db('rpc/icash_record_software_access','POST',{p_account:accountId,p_user:userId,p_context:purchaseContext(req)});}catch{console.error('[purchase-evidence] workspace access receipt unavailable');}
}
