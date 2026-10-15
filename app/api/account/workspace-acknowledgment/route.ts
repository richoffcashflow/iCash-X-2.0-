import {NextResponse} from 'next/server';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {allowedOrigin} from '@/lib/funding-policy';
import {purchaseContext} from '@/lib/purchase-acceptance';
import {workspaceAcknowledgmentVersion,workspaceAcknowledgmentDocument} from '@/lib/workspace-acknowledgment-policy';
import {workspaceAcknowledgmentHash} from '@/lib/workspace-acknowledgment';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
const input=z.object({version:z.literal(workspaceAcknowledgmentVersion),accepted:z.literal(true)}).strict();
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403,headers});
 try{
  const {accountId,userId}=await workAccount({allowInactiveMembership:true,allowUnacknowledged:true});
  const raw=await req.text();if(raw.length>1024)return NextResponse.json({error:'Invalid acknowledgment.'},{status:400,headers});
  const parsed=input.safeParse(JSON.parse(raw));
  if(!parsed.success)return NextResponse.json({error:'Review the current acknowledgment and select the checkbox before continuing.'},{status:409,headers});
  const receipt=await db<{accepted:boolean;acceptedAt:string;version:string}>('rpc/icash_accept_workspace_acknowledgment','POST',{p_account:accountId,p_user:userId,p_version:workspaceAcknowledgmentVersion,p_document:workspaceAcknowledgmentDocument,p_hash:workspaceAcknowledgmentHash,p_context:purchaseContext(req)});
  if(receipt?.accepted!==true||receipt.version!==workspaceAcknowledgmentVersion||!receipt.acceptedAt)throw Error('Receipt unavailable');
  return NextResponse.json(receipt,{headers});
 }catch(error){const auth=error instanceof Error&&['SIGN_IN_REQUIRED','ACCOUNT_REQUIRED'].includes(error.message);return NextResponse.json({error:auth?'Sign in to continue.':'Your acceptance could not be saved. Please try again.'},{status:auth?401:503,headers});}
}
export async function GET(){
 try{
  const {accountId,userId}=await workAccount({allowInactiveMembership:true,allowUnacknowledged:true});
  const [receipt]=await db<{document:string;accepted_at:string}[]>(`icash_workspace_acknowledgments?account_id=eq.${accountId}&user_id=eq.${userId}&version=eq.${workspaceAcknowledgmentVersion}&select=document,accepted_at&limit=1`);
  if(!receipt)return NextResponse.json({error:'No acceptance has been saved yet.'},{status:404,headers});
  const acceptedAt=new Date(receipt.accepted_at).toLocaleString('en-US',{timeZone:'America/Chicago',hour12:true,timeZoneName:'short'});
  return new Response(`${receipt.document}\n\nAccepted: ${acceptedAt}\n`,{headers:{...headers,'Content-Type':'text/plain; charset=utf-8','Content-Disposition':'attachment; filename="iCash-X-workspace-acknowledgment.txt"'}});
 }catch{return NextResponse.json({error:'Sign in to download your acknowledgment.'},{status:401,headers});}
}
