import {NextResponse} from 'next/server';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {allowedOrigin} from '@/lib/funding-policy';
import {outreachCampaignPolicy} from '@/lib/outreach-campaign';
import {z} from 'zod';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
const input=z.object({accepted:z.literal(true),version:z.string().max(80),mode:z.literal('sms_inbound')}).strict();
async function status(accountId:string,userId:string){
 const state=await db<{configured:boolean;released:boolean;acknowledgment:{acceptedAt:string;version:string}|null}>('rpc/icash_sms_inbound_campaign_status','POST',{p_account:accountId,p_user:userId});
 return {...state,policy:outreachCampaignPolicy,liveWorkReady:process.env.ICASH_LIVE_WORK_READY==='true'};
}
export async function GET(){try{const {accountId,userId}=await workAccount();return NextResponse.json(await status(accountId,userId),{headers});}catch{return NextResponse.json({error:'Sign in to check your campaign acknowledgment.'},{status:401,headers});}}
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403,headers});
 try{const {accountId,userId}=await workAccount();const raw=await req.text();if(Buffer.byteLength(raw)>1024)throw Error('Invalid request');const i=input.parse(JSON.parse(raw));
 if(i.version!==outreachCampaignPolicy.version)return NextResponse.json({error:'Review the current campaign acknowledgment.',policy:outreachCampaignPolicy},{status:409,headers});
 await db('rpc/icash_record_sms_inbound_campaign','POST',{p_account:accountId,p_user:userId,p_version:i.version,p_accepted:i.accepted});
 return NextResponse.json({...await status(accountId,userId),saved:true},{headers});
 }catch{return NextResponse.json({error:'Could not save the acknowledgment. Sign in and review the current terms; outreach remains gated.'},{status:400,headers});}
}
