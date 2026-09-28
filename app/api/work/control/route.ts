import {NextResponse} from 'next/server';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {allowedOrigin} from '@/lib/funding-policy';
import {z} from 'zod';
const input=z.object({action:z.enum(['pause','resume','takeover','return_to_bot']),screeningId:z.string().uuid().optional()}).strict();
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403});
 try{const {accountId,userId}=await workAccount();const raw=await req.text();if(raw.length>512)throw new Error();const i=input.parse(JSON.parse(raw));
 await db('rpc/icash_set_work_control','POST',{p_user:userId,p_account:accountId,p_action:i.action,p_screening:i.screeningId??null});
 return NextResponse.json({saved:true});}catch{return NextResponse.json({error:'Could not update your bot. Please retry.'},{status:400});}
}
