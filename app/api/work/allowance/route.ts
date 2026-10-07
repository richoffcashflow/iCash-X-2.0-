import {NextResponse} from 'next/server';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {allowedOrigin} from '@/lib/funding-policy';
import {limitRequest} from '@/lib/funding';
const headers={'Cache-Control':'private, no-store'};
export const dynamic='force-dynamic';
export async function GET(){try{const {accountId}=await workAccount();return NextResponse.json(await db('rpc/icash_daily_allowance','POST',{p_account:accountId}),{headers});}catch{return NextResponse.json({error:'Could not load today’s allowance.'},{status:503,headers});}}
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403,headers});
 try{const {accountId,userId}=await workAccount();await limitRequest(req,'daily-allowance',accountId,20,600);const raw=await req.text();if(raw.length>300)throw Error();const i=z.object({day:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),extraTotalCents:z.number().int().nonnegative().max(10000000)}).strict().parse(JSON.parse(raw));return NextResponse.json(await db('rpc/icash_allow_more_today','POST',{p_user:userId,p_account:accountId,p_day:i.day,p_extra_total:i.extraTotalCents}),{headers});}
 catch{return NextResponse.json({error:'Your balance or day changed. Refresh and choose the amount again.'},{status:409,headers});}
}
