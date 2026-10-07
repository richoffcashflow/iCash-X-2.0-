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
  const choices=await Promise.all(contacts.map(async c=>{const reason=await db<string|null>('rpc/icash_manual_contact_reason','POST',{p_account:accountId,p_screening:screeningId,p_phone:c.phone,p_channel:'voice'});return {...c,available:reason===null,reason:reason??'Call using your business number.'};}));
  const attempts=await db<{id:string;state:string;created_at:string;consent_at:string|null;last_error:string|null}[]>(`icash_call_recordings?account_id=eq.${accountId}&screening_id=eq.${screeningId}&call_sid=not.is.null&conversation_id=is.null&select=id,state,created_at,consent_at,last_error&order=created_at.desc&limit=3`);
  const [personalCalls,deals]=await Promise.all([db<{id:string;state:string;callback_phone:string;ended_at:string|null}[]>(`icash_customer_phone_calls?account_id=eq.${accountId}&screening_id=eq.${screeningId}&select=id,state,callback_phone,ended_at&order=created_at.desc&limit=1`),db<{id:string}[]>(`icash_deal_files?account_id=eq.${accountId}&screening_id=eq.${screeningId}&select=id&limit=1`)]);
  const [thread]=deals[0]?await db<{sender:string}[]>(`icash_text_threads?account_id=eq.${accountId}&deal_id=eq.${deals[0].id}&retired_at=is.null&select=sender&limit=1`):[];
  return NextResponse.json({personalCalls,businessNumber:thread?.sender??null,attempts:attempts.map(a=>({id:a.id,createdAt:a.created_at,status:['failed','declined','absent'].includes(a.state)?'Call ended before the AI conversation':'Call connecting',costPending:a.last_error==='terminal_carrier_reconciliation_required'})),contacts:choices,reason:choices.length?undefined:'No phone number has been saved for this property yet.'},{headers});
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
