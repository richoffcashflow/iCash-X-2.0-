import {customerPhoneAudioAvailable,type CustomerPhoneCall} from '@/lib/customer-phone';
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
  const choices=await Promise.all(contacts.map(async c=>{
   const reason=await db<string|null>('rpc/icash_manual_contact_reason','POST',{p_account:accountId,p_screening:screeningId,p_phone:c.phone,p_channel:'voice'});
   const businessNumber=reason===null?await db<string|null>('rpc/icash_customer_call_sender','POST',{p_account:accountId,p_screening:screeningId,p_recipient:c.phone}):null;
   return {...c,businessNumber,available:reason===null&&businessNumber!==null,reason:reason??(businessNumber?'Call using your business number.':'Your business calling number is unavailable. Please try again.')};
  }));
  const attempts=await db<{id:string;state:string;created_at:string;consent_at:string|null;last_error:string|null}[]>(`icash_call_recordings?account_id=eq.${accountId}&screening_id=eq.${screeningId}&call_sid=not.is.null&conversation_id=is.null&select=id,state,created_at,consent_at,last_error&order=created_at.desc&limit=3`);
  const personalCalls=await db<CustomerPhoneCall[]>(`icash_customer_phone_calls?account_id=eq.${accountId}&screening_id=eq.${screeningId}&select=id,state,connection_type,callback_phone,ended_at,recording_required,recording_state,recording_sid,recording_expires_at,recording_deleted_at&order=created_at.desc&limit=1`);
  return NextResponse.json({personalCalls:personalCalls.map(c=>({id:c.id,state:c.state,connection_type:c.connection_type,callback_phone:c.callback_phone,ended_at:c.ended_at,audioAvailable:customerPhoneAudioAvailable(c)})),attempts:attempts.map(a=>({id:a.id,createdAt:a.created_at,status:['failed','declined','absent'].includes(a.state)?'Call ended before the AI conversation':'Call connecting',costPending:a.last_error==='terminal_carrier_reconciliation_required'})),contacts:choices,reason:choices.length?undefined:'No phone number has been saved for this property yet.'},{headers});
 }catch{return NextResponse.json({error:'Could not load contacts. Try again.'},{status:503,headers});}
}
// External dialer launches are retired; calls stay inside the authenticated browser flow.
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403,headers});
 try{await workAccount();return NextResponse.json({error:'Use the Call button in iCash X.'},{status:410,headers});}
 catch{return NextResponse.json({error:'Sign in to call.'},{status:401,headers});}
}
