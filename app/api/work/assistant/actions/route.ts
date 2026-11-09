import {NextResponse} from 'next/server';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {allowedOrigin} from '@/lib/funding-policy';
import {db} from '@/lib/stripe-test';
import {dispatchTextMessage} from '@/lib/text-message-service';
import {customerTextStatus} from '@/lib/customer-text-status';
import {smsLength} from '@/lib/sms-length';
import type {AssistantAnswer} from '@/lib/workspace-assistant-policy';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
const selection=z.object({questionId:z.guid(),actionIndex:z.number().int().min(0).max(2)});
function failure(){return NextResponse.json({error:'Could not confirm this action. Check its saved status before trying again.'},{status:409,headers});}

export async function GET(req:Request){
 try{
  const {accountId}=await workAccount({requireVip:true});const params=new URL(req.url).searchParams;
  const i=selection.parse({questionId:params.get('questionId'),actionIndex:Number(params.get('actionIndex'))});
  const [q]=await db<{answer:AssistantAnswer;completed_at:string}[]>(`icash_workspace_questions?account_id=eq.${accountId}&id=eq.${i.questionId}&state=eq.complete&archived_at=is.null&select=answer,completed_at&limit=1`);
  const action=q?.answer.actions[i.actionIndex];if(!action?.draft||!action.threadId||action.threadId!==action.draft.threadId||!action.screeningId)throw Error();
  const [thread]=await db<{id:string;deal_id:string;party:string}[]>(`icash_text_threads?account_id=eq.${accountId}&id=eq.${action.threadId}&retired_at=is.null&select=id,deal_id,party&limit=1`);
  if(!thread)throw Error();
  const [deal]=await db<{terms:{address?:string;practice?:boolean|string}}[]>(`icash_deal_files?account_id=eq.${accountId}&id=eq.${thread.deal_id}&screening_id=eq.${action.screeningId}&select=terms&limit=1`);
  if(!deal||String(deal.terms.practice)==='true')throw Error();
  const [settings,actions]=await Promise.all([
   db<{enabled:boolean}[]>('icash_assistant_action_settings?id=eq.1&select=enabled'),
   db<{message_id:string}[]>(`icash_assistant_text_actions?account_id=eq.${accountId}&question_id=eq.${i.questionId}&action_index=eq.${i.actionIndex}&select=message_id&limit=1`)
  ]);
  const [receipt]=actions[0]?await db<{id:string;body:string;request_key:string;state:string}[]>(`icash_text_messages?account_id=eq.${accountId}&thread_id=eq.${thread.id}&id=eq.${actions[0].message_id}&select=id,body,request_key,state&limit=1`):[];
  const [latest]=await db<{id:string;body:string;direction:string;state:string}[]>(`icash_text_messages?account_id=eq.${accountId}&thread_id=eq.${thread.id}${receipt?'&id=neq.'+receipt.id:''}&select=id,body,direction,state&order=created_at.desc,id.desc&limit=1`);
  const changed=(latest?.id??null)!==action.draft.latestMessageId;
  const expired=!receipt&&(!q.completed_at||Date.parse(q.completed_at)<Date.now()-86400000);
  const reason=changed?'The conversation changed. Review the latest messages and ask for a fresh reply.':expired?'This suggestion has expired. Ask for a fresh reply.':!settings[0]?.enabled?'Reply actions are temporarily unavailable. Open the conversation to continue.':await db<string|null>('rpc/icash_manual_text_reason','POST',{p_account:accountId,p_thread:thread.id,...(receipt?{p_exclude:receipt.id}:{})});
  return NextResponse.json({address:deal.terms.address??'Selected property',party:thread.party,body:receipt?.body??action.draft.body,latest:latest??null,receipt:receipt??null,reason},{headers});
 }catch{return failure();}
}

export async function POST(req:Request){
 if(!allowedOrigin(req))return new Response(null,{status:403});
 try{
  const {accountId,userId}=await workAccount({requireVip:true});const raw=await req.text();if(raw.length>2000)throw Error();
  const i=selection.extend({requestKey:z.guid(),message:z.string().trim().min(1).max(160)}).strict().parse(JSON.parse(raw));
  if(!smsLength(i.message).fits)return NextResponse.json({error:'Keep the reply within one text message.',notSent:true},{status:400,headers});
  const queued=await db<{id?:string;threadId?:string;error?:string}>('rpc/icash_queue_assistant_text','POST',{p_actor:userId,p_account:accountId,p_question:i.questionId,p_index:i.actionIndex,p_key:i.requestKey,p_body:i.message});
  if(queued.error)return NextResponse.json({error:queued.error,notSent:true},{status:409,headers});
  if(!queued.id||!queued.threadId)throw Error();
  let dispatched:{status:string}|undefined;
  try{dispatched=await dispatchTextMessage(accountId,queued.id,true);}catch{/* Only the original receipt can resolve this attempt. */}
  try{return NextResponse.json({...queued,...await customerTextStatus(accountId,queued.id,queued.threadId,dispatched?.status)},{headers});}
  catch{return NextResponse.json({...queued,status:'message_delivery_needs_review'},{headers});}
 }catch{return failure();}
}
