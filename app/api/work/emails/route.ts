import {NextResponse} from 'next/server';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {allowedOrigin} from '@/lib/funding-policy';
import {db} from '@/lib/stripe-test';
import {dealEmailSchema} from '@/lib/deal-email-policy';
import {dealEmailConfigured,dispatchDealEmail} from '@/lib/deal-email-service';
export const dynamic='force-dynamic';
export const maxDuration=60;
const headers={'Cache-Control':'private, no-store'};
export async function GET(req:Request){
 try{
 const {accountId}=await workAccount(),params=new URL(req.url).searchParams;
 const dealId=z.string().uuid().parse(params.get('dealId'));
 const before=params.get('before');if(before)z.string().datetime({offset:true}).parse(before);
 const beforeId=before?z.string().uuid().parse(params.get('beforeId')):null;
 const [deal]=await db<{id:string}[]>(`icash_deal_files?account_id=eq.${accountId}&id=eq.${dealId}&select=id`);if(!deal)throw Error();
 const [contacts,rows,rates]=await Promise.all([
 db<unknown[]>('rpc/icash_deal_email_contacts','POST',{p_account:accountId,p_deal:dealId}),
 db<{id:string;created_at:string}[]>(`icash_deal_emails?account_id=eq.${accountId}&deal_id=eq.${dealId}&select=id,direction,recipient,contact_key,subject,body_text,state,created_at&order=created_at.desc,id.desc&limit=21${before?`&or=(created_at.lt.${encodeURIComponent(before)},and(created_at.eq.${encodeURIComponent(before)},id.lt.${beforeId}))`:''}`),
 db<{id:string;charge_cents:number}[]>(`icash_operation_rates?operation=eq.manual_email&enabled=eq.true&expires_at=gt.${new Date().toISOString()}&select=id,charge_cents&order=verified_at.desc&limit=1`)]);
 const messages=rows.slice(0,20),last=messages.at(-1);
 return NextResponse.json({contacts,messages,configured:dealEmailConfigured(),rate:rates[0]??null,next:rows.length>20&&last?{before:last.created_at,beforeId:last.id}:null},{headers});
 }catch{return NextResponse.json({error:'Email could not load. Please retry.'},{status:400,headers});}
}
export async function POST(req:Request){
 if(!allowedOrigin(req))return new Response(null,{status:403});
 try{
 const {accountId,userId}=await workAccount();if(!dealEmailConfigured())return NextResponse.json({error:'Email setup is not ready. Your draft has not been sent.'},{status:503,headers});
 const raw=await req.text();if(raw.length>14000)throw Error();const b=dealEmailSchema.parse(JSON.parse(raw));
 const id=await db<string>('rpc/icash_queue_deal_email','POST',{p_account:accountId,p_actor:userId,p_deal:b.dealId,p_contact:b.contactKey,p_key:b.requestKey,p_subject:b.subject,p_body:b.message,p_rate:b.rateId});
 return NextResponse.json({id,...await dispatchDealEmail(accountId,id)},{headers});
 }catch{return NextResponse.json({error:'Email was held. Check the contact, balance, bot status and current price before retrying.'},{status:409,headers});}
}
