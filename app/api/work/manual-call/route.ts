import {NextResponse} from 'next/server';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {allowedOrigin} from '@/lib/funding-policy';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
/** Saved numbers are available to the customer independently of bot readiness. */
export async function GET(req:Request){
 try{
  const {accountId}=await workAccount();const screeningId=z.string().uuid().parse(new URL(req.url).searchParams.get('screeningId'));
  const contacts=await db<{phone:string;name:string;phone_type:string;blocked:boolean}[]>('rpc/icash_manual_contacts','POST',{p_account:accountId,p_screening:screeningId});
  const choices=await Promise.all(contacts.map(async c=>{const reason=await db<string|null>('rpc/icash_manual_contact_reason','POST',{p_account:accountId,p_screening:screeningId,p_phone:c.phone,p_channel:'voice'});return {...c,available:reason===null,reason:reason??'Opens your phone app. You place the call.'};}));
  return NextResponse.json({contacts:choices,reason:choices.length?undefined:'No phone number has been saved for this property yet.'},{headers});
 }catch{return NextResponse.json({error:'Could not load contacts. Try again.'},{status:503,headers});}
}
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403,headers});
 try{
  const {accountId,userId}=await workAccount();const raw=await req.text();if(raw.length>512)throw Error();
  const {screeningId,phone}=z.object({screeningId:z.string().uuid(),phone:z.string().regex(/^\+1[2-9][0-9]{9}$/)}).strict().parse(JSON.parse(raw));
  const result=await db<{manual?:boolean;dialUrl?:string;error?:string}>('rpc/icash_start_manual_call','POST',{p_actor:userId,p_account:accountId,p_screening:screeningId,p_phone:phone});
  return NextResponse.json(result,{status:result.error?409:200,headers});
 }catch{return NextResponse.json({error:'Could not start the call. Please retry.'},{status:409,headers});}
}
