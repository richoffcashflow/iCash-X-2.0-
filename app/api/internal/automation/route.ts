import {NextResponse} from 'next/server';
import {db} from '@/lib/stripe-test';
import {discoverForAccount} from '@/lib/discovery-service';
import {reconcileLiveConversation} from '@/lib/live-conversation-service';
import {enrichForAccount} from '@/lib/owner-enrichment-service';
export const dynamic='force-dynamic';
export const maxDuration=60;
/** Short-lived, one-use DB capabilities; no credentials or account IDs accepted from requests. */
export async function POST(request:Request){
 const headers={'Cache-Control':'private, no-store'};
 const token=request.headers.get('authorization')?.replace(/^Bearer /,'');
 if(!token||!/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}){2}$/.test(token))return NextResponse.json({error:'Unauthorized'},{status:401,headers});
 let ticket:{id:string;accountId:string;kind:string;screeningId:string|null;liveCallId:string|null}|null=null;
 try{
  ticket=await db('rpc/icash_consume_automation','POST',{p_token:token});
  if(!ticket)return NextResponse.json({error:'Expired or consumed'},{status:401,headers});
  const result=ticket.kind==='voice_result'&&ticket.liveCallId?await reconcileLiveConversation(ticket.accountId,ticket.liveCallId):ticket.kind==='discovery'?await discoverForAccount(ticket.accountId):ticket.kind==='contacts'&&ticket.screeningId?await enrichForAccount(ticket.accountId,ticket.screeningId):{status:'held'};
  const success=['screening_queued','empty','contacts_saved','conversation_saved','awaiting_conversation'].includes(result.status);
  await db('rpc/icash_finish_automation','POST',{p_id:ticket.id,p_success:success,p_outcome:result.status});
  return NextResponse.json({status:result.status},{headers});
 }catch{
  if(ticket)try{await db('rpc/icash_finish_automation','POST',{p_id:ticket.id,p_success:false,p_outcome:'held_for_reconciliation'});}catch{/* Preserve consumed capability on database failure. */}
  return NextResponse.json({status:'held_for_reconciliation'},{status:503,headers});
 }
}
