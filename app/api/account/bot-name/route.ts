import {NextResponse} from 'next/server';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {allowedOrigin} from '@/lib/funding-policy';
const headers={'Cache-Control':'private, no-store'};
export async function POST(req:Request){if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403,headers});try{const {accountId,userId}=await workAccount();const raw=await req.text();if(raw.length>500)throw Error();const i=z.object({name:z.string().trim().min(1).max(64).regex(/^[^\u0000-\u001f<>{}]+$/)}).strict().parse(JSON.parse(raw));await db('rpc/icash_save_vip_bot_name','POST',{p_user:userId,p_account:accountId,p_name:i.name});return NextResponse.json({saved:true},{headers});}catch{return NextResponse.json({error:'An active VIP plan and a valid bot name are required.'},{status:409,headers});}}
