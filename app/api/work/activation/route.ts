import {NextResponse} from 'next/server';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {allowedOrigin} from '@/lib/funding-policy';
import {db} from '@/lib/stripe-test';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET(){
 try{const {accountId,userId}=await workAccount();return NextResponse.json(await db('rpc/icash_spend_activation_review','POST',{p_user:userId,p_account:accountId}),{headers});}
 catch{return NextResponse.json({error:'Spending activation review is unavailable. Your existing settings have not been changed.'},{status:503,headers});}
}
const input=z.object({accepted:z.literal(true),version:z.literal('activation-2026-10-03.1'),reviewKey:z.string().regex(/^[a-f0-9]{32}$/)}).strict();
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403,headers});
 try{const {accountId,userId}=await workAccount();const raw=await req.text();if(raw.length>512)throw Error();const i=input.parse(JSON.parse(raw));
 return NextResponse.json(await db('rpc/icash_confirm_spend_activation','POST',{p_user:userId,p_account:accountId,p_review_key:i.reviewKey,p_consent_version:i.version,p_accepted:i.accepted}),{headers});
 }catch{return NextResponse.json({error:'Could not confirm spending activation. Refresh this review before trying again; do not pay again.'},{status:409,headers});}
}
