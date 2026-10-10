import {NextResponse} from 'next/server';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {allowedOrigin} from '@/lib/funding-policy';
import {db} from '@/lib/stripe-test';
import {cancellationView,reconcileCancellation} from '@/lib/agreement-cancellation-service';

export const dynamic='force-dynamic';
export const maxDuration=120;
const headers={'Cache-Control':'private, no-store'};
const uuid=z.string().uuid();
const input=z.discriminatedUnion('action',[
 z.object({action:z.literal('request'),dealId:uuid,kind:z.enum(['purchase','assignment']),reason:z.string().trim().min(3).max(1000),key:uuid,revision:z.string().regex(/^[a-f0-9]{32}$/),confirmed:z.literal(true)}).strict(),
 z.object({action:z.literal('check'),id:uuid}).strict(),
 z.object({action:z.literal('complete'),id:uuid,confirmed:z.literal(true),releaseReference:z.string().trim().min(8).max(1000),resolutionReference:z.string().trim().max(1000)}).strict()
]);

export async function GET(req:Request){
 try{
  const {accountId,userId}=await workAccount({allowInactiveMembership:true});
  return NextResponse.json(await cancellationView(accountId,userId,uuid.parse(new URL(req.url).searchParams.get('dealId'))),{headers});
 }catch{return NextResponse.json({error:'Could not load cancellation controls. Refresh and try again.'},{status:503,headers});}
}

export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403,headers});
 let held=false;
 try{
  const {accountId,userId}=await workAccount({allowInactiveMembership:true});
  const raw=await req.text();if(raw.length>6000)throw Error('Request too large');
  const body=input.parse(JSON.parse(raw));
  const id=body.action==='request'?await db<string>('rpc/icash_request_cancellation','POST',{
   p_account:accountId,p_actor:userId,p_deal:body.dealId,p_kind:body.kind,p_reason:body.reason,p_key:body.key,p_revision:body.revision
  }):body.id;
  held=true;
  const dealId=await reconcileCancellation(accountId,userId,id);
  await db<boolean>('rpc/icash_finish_cancellation','POST',{
   p_account:accountId,p_actor:userId,p_id:id,p_confirmed:body.action==='complete',
   p_release:body.action==='complete'?body.releaseReference:'',p_resolution:body.action==='complete'?body.resolutionReference:''
  });
  return NextResponse.json(await cancellationView(accountId,userId,dealId),{headers});
 }catch{return NextResponse.json({error:held?'The cancellation may still need review. Refresh to see the saved hold before taking another action.':'Could not start cancellation. Refresh to check whether the agreement changed or a cancellation is already open.'},{status:409,headers});}
}
