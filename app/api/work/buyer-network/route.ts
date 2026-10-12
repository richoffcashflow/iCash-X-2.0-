import {NextResponse} from 'next/server';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {networkError} from '@/lib/buyer-network';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET(req:Request){
 try{const {accountId}=await workAccount();
  if(!await db<boolean>('rpc/icash_vip_features_active','POST',{p_account:accountId}))throw Error('VIP_REQUIRED');
  const dealId=z.string().uuid().nullable().parse(new URL(req.url).searchParams.get('dealId'));
  if(dealId){const [deal]=await db<{id:string}[]>(`icash_deal_files?id=eq.${dealId}&account_id=eq.${accountId}&select=id`);if(!deal)return NextResponse.json({error:'Deal not found.'},{status:404,headers});}
  return NextResponse.json(await db('rpc/icash_network_workspace','POST',{p_account:accountId,p_deal:dealId}),{headers});
 }catch(error){const e=networkError(error);return NextResponse.json({error:e.error},{status:e.status,headers});}
}
export async function POST(req:Request){
 if(req.headers.get('origin')!==new URL(req.url).origin)return NextResponse.json({error:'Same-origin session required.'},{status:403,headers});
 try{const {accountId,userId}=await workAccount();const raw=await req.text();if(raw.length>1500)throw Error('Too long');
  const input=z.object({enabled:z.boolean(),mailingAddress:z.string().trim().min(10).max(300)}).strict().parse(JSON.parse(raw));
  await db('rpc/icash_network_save_settings','POST',{p_account:accountId,p_user:userId,p_enabled:input.enabled,p_address:input.mailingAddress});
  return NextResponse.json({saved:true},{headers});
 }catch(error){const e=networkError(error);return NextResponse.json({error:e.error},{status:e.status,headers});}
}
export async function PATCH(req:Request){
 if(req.headers.get('origin')!==new URL(req.url).origin)return NextResponse.json({error:'Same-origin session required.'},{status:403,headers});
 try{const {accountId,userId}=await workAccount();const raw=await req.text();if(raw.length>500)throw Error('Too long');
  const input=z.object({matchId:z.string().uuid()}).strict().parse(JSON.parse(raw));
  await db('rpc/icash_network_ack_response','POST',{p_account:accountId,p_user:userId,p_match:input.matchId});
  return NextResponse.json({saved:true},{headers});
 }catch(error){const e=networkError(error);return NextResponse.json({error:e.error},{status:e.status,headers});}
}
