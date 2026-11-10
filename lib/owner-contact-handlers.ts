import {NextResponse} from 'next/server';
import {z} from 'zod';
import {allowedOrigin} from '@/lib/funding-policy';
import {db} from '@/lib/stripe-test';
import {dispatchTextMessage} from '@/lib/text-message-service';
import {customerTextStatus} from '@/lib/customer-text-status';
import {threadConversationCalls} from '@/lib/thread-conversation-calls';
import {dealTermsSchema} from '@/lib/deal-documents';
import {recordingGateCostPending} from '@/lib/recording-gate-diagnostics';
import {type CustomerPhoneCall} from '@/lib/customer-phone';
import {startCustomerPhoneCall,endCustomerBrowserCall} from '@/lib/customer-phone';
import {browserPhoneIdentity,browserPhoneToken,type BrowserPhoneCredentials} from '@/lib/browser-phone-credentials';
import {reconcileCustomerPhoneCall,getCustomerPhoneCall,customerPhoneReadiness,customerPhoneAudioAvailable,customerPhoneProvider,customerPhoneRecordingReceipt} from '@/lib/customer-phone';
import {ownerContactAction,type OwnerContact} from './owner-contact-access';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie','Referrer-Policy':'no-referrer'};
type Thread={id:string;recipient:string;paused:boolean;party:string};
type Message={id:string;created_at:string;state:string;direction:string;request_key:string|null;customer_author_id:string|null};
const messageFields='id,thread_id,direction,body,state,attachments,created_at,request_key,customer_author_id';
async function config(){const [c]=await db<BrowserPhoneCredentials[]>('icash_browser_phone_config?id=eq.1&state=eq.ready&select=*');return c;}
// These account-bound handlers reuse the customer admission and delivery services.
// Only the explicit owner route below can provide the verified view context.
export async function messagesGET(req:Request,access:OwnerContact){
 const headers={'Cache-Control':'private, no-store'};
 try{const {accountId,userId}=access;const params=new URL(req.url).searchParams;const dealId=z.guid().parse(params.get('dealId'));
 const afterThread=params.get('afterThread');if(afterThread)z.guid().parse(afterThread);
 const threadRows=await db<Thread[]>(`icash_text_threads?account_id=eq.${accountId}&deal_id=eq.${dealId}&retired_at=is.null&select=id,recipient,paused,party&order=id.desc&limit=21${afterThread?`&id=lt.${afterThread}`:''}`);
 const threads=threadRows.slice(0,20);
 const preferred=!params.get('threadId')&&!afterThread?await db<string|null>('rpc/icash_latest_seller_text_thread','POST',{p_account:accountId,p_deal:dealId}):null;
 const threadId=params.get('threadId')?z.guid().parse(params.get('threadId')):preferred??(threads.find(t=>t.party==='seller')??threads[0])?.id;
 if(threadId&&!threads.some(t=>t.id===threadId)){
  const selected=await db<Thread[]>(`icash_text_threads?account_id=eq.${accountId}&deal_id=eq.${dealId}&id=eq.${threadId}&retired_at=is.null&select=id,recipient,paused,party&limit=1`);
  if(selected.length!==1||selected[0].id!==threadId)throw Error();threads.push(selected[0]);
 }
 const summaries=threads.length?await db<{thread_id:string;preview:string;received_at:string;unread_count:number}[]>('rpc/icash_text_thread_reply_summaries','POST',{p_account:accountId,p_threads:threads.map(t=>t.id)}):[];
 const before=params.get('before');if(before)z.string().datetime({offset:true}).parse(before);const beforeId=before?z.guid().parse(params.get('beforeId')):null;
 const requestKey=params.get('requestKey');if(requestKey)z.guid().parse(requestKey);
 const [rows,receipts,firstRows]=threadId?await Promise.all([
 db<Message[]>(`icash_text_messages?account_id=eq.${accountId}&thread_id=eq.${threadId}&select=${messageFields}&order=created_at.desc,id.desc&limit=21${before?`&or=(created_at.lt.${encodeURIComponent(before)},and(created_at.eq.${encodeURIComponent(before)},id.lt.${beforeId}))`:''}`),
 requestKey?db<{state:string;request_key:string}[]>(`icash_text_messages?account_id=eq.${accountId}&thread_id=eq.${threadId}&customer_author_id=eq.${userId}&request_key=eq.${requestKey}&select=state,request_key&limit=1`):Promise.resolve([]),
 db<Message[]>(`icash_text_messages?account_id=eq.${accountId}&thread_id=eq.${threadId}&select=${messageFields}&order=created_at.asc,id.asc&limit=1`)
 ]):[[],[],[]];
 const present=({customer_author_id,request_key,...message}:Message)=>({...message,author:message.direction==='incoming'?'contact':customer_author_id===userId?'you':customer_author_id?'customer':'bot',retryKey:customer_author_id===userId&&message.state==='ready'?request_key:null});
 const messages=rows.slice(0,20).map(present),last=messages.at(-1),current=threads.find(t=>t.id===threadId);
 const callsResult=current&&params.get('includeCalls')==='true'?threadConversationCalls(db,accountId,{...current,dealId},before??null,rows.length>20&&last?last.created_at:null,process.env.ICASH_RECORDING_RECEIPTS_READY==='true'):Promise.resolve({calls:[],callsUnavailable:false});
 // Reading saved messages must not depend on a live spending/contact admission
 // check. The composer checks availability separately; POST keeps final admission.
 return NextResponse.json({...await callsResult,availabilityRequired:true,threads:threads.map(t=>({...t,reply:summaries.find(s=>s.thread_id===t.id)??null,manualReply:false,sendReason:t.id===threadId?'Checking text availability…':null})),threadId,messages,firstMessage:firstRows[0]?present(firstRows[0]):null,receipt:requestKey?(receipts[0]??{state:'not_found',request_key:requestKey}):null,nextThread:threadRows.length>20?threadRows[19].id:null,next:rows.length>20&&last?{before:last.created_at,beforeId:last.id}:null},{headers});
 }catch{return NextResponse.json({error:'Messages unavailable'},{status:400,headers});}
}

export async function messagesPOST(req:Request,access:OwnerContact){
 if(!allowedOrigin(req))return new Response(null,{status:403});
 try{const {accountId,userId}=access;const raw=await req.text();if(raw.length>10000)throw Error();
 const b=z.object({threadId:z.guid(),requestKey:z.guid(),message:z.string().trim().max(1000),assetIds:z.array(z.guid()).max(3).default([])}).strict().parse(JSON.parse(raw));
 const queued=await ownerContactAction<{id:string;manual:boolean;error?:string}>(access,'text',{p_actor:userId,p_account:accountId,p_thread:b.threadId,p_key:b.requestKey,p_body:b.message,p_assets:b.assetIds});
 if(queued.error)return NextResponse.json({error:queued.error,notSent:true},{status:409});
 let dispatched:{status:string}|undefined;
 try{dispatched=await dispatchTextMessage(accountId,queued.id,true);}catch{/* Reconcile a failed claim before allowing another submission. */}
 try{return NextResponse.json({...queued,...await customerTextStatus(accountId,queued.id,b.threadId,dispatched?.status)});}
 catch{return NextResponse.json({...queued,status:'message_delivery_needs_review'});}
 }catch{return NextResponse.json({error:'Could not queue this text. Refresh the conversation and try again.'},{status:409});}
}

export async function availabilityGET(req:Request,access:OwnerContact){
 const headers={'Cache-Control':'private, no-store'};
 try{
  const {accountId}=access;
  const threadId=z.guid().parse(new URL(req.url).searchParams.get('threadId'));
  const rows=await db<{id:string}[]>(`icash_text_threads?account_id=eq.${accountId}&id=eq.${threadId}&retired_at=is.null&select=id&limit=1`);
  if(rows.length!==1||rows[0].id!==threadId)return NextResponse.json({error:'Conversation unavailable.'},{status:404,headers});
  const sendReason=await db<string|null>('rpc/icash_manual_text_reason','POST',{p_account:accountId,p_thread:threadId});
  if(sendReason!==null&&typeof sendReason!=='string')throw Error();
  return NextResponse.json({threadId,sendReason,manualReply:true},{headers});
 }catch{return NextResponse.json({error:'Text sending is temporarily unavailable. Your conversation and draft are saved.'},{status:503,headers});}
}

export async function textContactGET(req:Request,access:OwnerContact){
 try{
  const {accountId}=access;const screeningId=z.guid().parse(new URL(req.url).searchParams.get('screeningId'));
  const [contacts,deals]=await Promise.all([
   db<{phone:string;name:string;phone_type:string;blocked:boolean}[]>('rpc/icash_manual_contacts','POST',{p_account:accountId,p_screening:screeningId}).catch(()=>null),
   db<{id:string}[]>(`icash_deal_files?account_id=eq.${accountId}&screening_id=eq.${screeningId}&select=id&limit=1`)
  ]);
  const threadId=deals[0]?await db<string|null>('rpc/icash_latest_seller_text_thread','POST',{p_account:accountId,p_deal:deals[0].id}):null;
  if(contacts===null&&!threadId)throw Error();
  return NextResponse.json({contacts:contacts??[],contactsUnavailable:contacts===null,dealId:threadId?deals[0].id:null,threadId},{headers});
 }catch{return NextResponse.json({error:'Could not load contacts.'},{status:503,headers});}
}

export async function textContactPOST(req:Request,access:OwnerContact){
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403,headers});
 try{
  const {accountId,userId}=access;const raw=await req.text();if(raw.length>512)throw Error();
  const {screeningId,phone}=z.object({screeningId:z.guid(),phone:z.string().regex(/^\+1[2-9][0-9]{9}$/)}).strict().parse(JSON.parse(raw));
  const result=await ownerContactAction<{dealId?:string;threadId?:string;error?:string}>(access,'prepare_text',{p_actor:userId,p_account:accountId,p_screening:screeningId,p_phone:phone,p_terms:dealTermsSchema.parse({})});
  return NextResponse.json(result,{status:result.error?409:200,headers});
 }catch{return NextResponse.json({error:'Could not open this conversation. Try again.'},{status:409,headers});}
}

export async function manualCallGET(req:Request,access:OwnerContact){
 try{
  const {accountId}=access;const screeningId=z.guid().parse(new URL(req.url).searchParams.get('screeningId'));
  const contacts=await db<{phone:string;name:string;phone_type:string;blocked:boolean}[]>('rpc/icash_manual_contacts','POST',{p_account:accountId,p_screening:screeningId});
  const choices=await Promise.all(contacts.map(async c=>{
   const reason=await db<string|null>('rpc/icash_manual_contact_reason','POST',{p_account:accountId,p_screening:screeningId,p_phone:c.phone,p_channel:'voice'});
   const businessNumber=reason===null?await db<string|null>('rpc/icash_customer_call_sender','POST',{p_account:accountId,p_screening:screeningId,p_recipient:c.phone}):null;
   return {...c,businessNumber,available:reason===null&&businessNumber!==null,reason:reason??(businessNumber?'Call using your business number.':'Your business calling number is unavailable. Please try again.')};
  }));
  const attempts=await db<{id:string;state:string;created_at:string;consent_at:string|null;last_error:string|null;last_action:string|null}[]>(`icash_call_recordings?account_id=eq.${accountId}&screening_id=eq.${screeningId}&call_sid=not.is.null&conversation_id=is.null&select=id,state,created_at,consent_at,last_error,last_action&order=created_at.desc&limit=3`);
  const personalCalls=await db<CustomerPhoneCall[]>(`icash_customer_phone_calls?account_id=eq.${accountId}&screening_id=eq.${screeningId}&select=id,state,connection_type,callback_phone,ended_at,recording_required,recording_state,recording_sid,recording_expires_at,recording_deleted_at&order=created_at.desc&limit=1`);
  return NextResponse.json({personalCalls:personalCalls.map(c=>({id:c.id,state:c.state,connection_type:c.connection_type,callback_phone:c.callback_phone,ended_at:c.ended_at,audioAvailable:customerPhoneAudioAvailable(c)})),attempts:attempts.map(a=>({id:a.id,createdAt:a.created_at,status:['failed','declined','absent'].includes(a.state)?'Call ended before the AI conversation':'Call connecting',costPending:recordingGateCostPending(a.last_error,a.last_action)})),contacts:choices,reason:choices.length?undefined:'No phone number has been saved for this property yet.'},{headers});
 }catch{return NextResponse.json({error:'Could not load contacts. Try again.'},{status:503,headers});}
}
// External dialer launches are retired; calls stay inside the authenticated browser flow.

export async function browserCallGET(req:Request,access:OwnerContact){try{if(process.env.VERCEL_ENV==='preview')return Response.json({ready:false},{headers});const c=await config();return Response.json({ready:!!c&&c.provider_account_sid===process.env.TWILIO_ACCOUNT_SID},{headers});}catch{return Response.json({ready:false},{headers});}}

export async function browserCallPOST(req:Request,access:OwnerContact){
 if(!allowedOrigin(req))return new Response(null,{status:403,headers});
 try{
  if(process.env.VERCEL_ENV==='preview')throw Error('BROWSER_PHONE_SETUP_REQUIRED');
  const raw=await req.text();if(raw.length>1024)throw Error('INVALID_REQUEST');
  const body=z.discriminatedUnion('action',[
   z.object({action:z.literal('end'),id:z.guid()}).strict(),
   z.object({action:z.enum(['prepare','start']),screeningId:z.guid(),phone:z.string().regex(/^\+1[2-9][0-9]{9}$/),requestKey:z.guid()}).strict(),
  ]).parse(JSON.parse(raw));
  const owner=access;
  if(body.action==='end'){await ownerContactAction(access,'end_call',{p_id:body.id});return Response.json(await endCustomerBrowserCall(body.id,owner.accountId),{headers});}
  const c=await config();if(!c)throw Error('BROWSER_PHONE_SETUP_REQUIRED');
  const identity=browserPhoneIdentity(owner.accountId,owner.userId,body.requestKey);
  // Validate credentials before creating any carrier work; secret never leaves the server.
  const token=browserPhoneToken(c,identity);
  if(body.action==='prepare'){
   const reason=await db<string|null>('rpc/icash_manual_contact_reason','POST',{p_account:owner.accountId,p_screening:body.screeningId,p_phone:body.phone,p_channel:'voice'});
   if(reason)return Response.json({error:reason},{status:409,headers});
   return Response.json({token},{headers});
  }
  const result=await startCustomerPhoneCall({...owner,...body,ownerView:{viewId:access.viewId,sessionId:access.sessionId},callbackPhone:'client:'+identity,browser:true});
  return Response.json(result,{status:'error' in result?409:200,headers});
 }catch(e){
  const key=e instanceof Error?e.message:'';
  const message=key==='BROWSER_PHONE_SETUP_REQUIRED'?'Calling is temporarily unavailable. Please try again.':key==='PHONE_SENDER_UNAVAILABLE'?'Your business calling number is unavailable. Please try again.':key==='PHONE_CONTACT_UNAVAILABLE'?'This contact cannot be called.':key==='PHONE_PRICE_UNAVAILABLE'?'Calling prices could not be checked. Please try again.':'Could not connect the call. Please try again.';
  return Response.json({error:message},{status:key==='SIGN_IN_REQUIRED'?401:409,headers});
 }
}

export async function businessCallGET(req:Request,access:OwnerContact){try{
 const owner=access,params=new URL(req.url).searchParams;
 if(params.has('screeningId'))return Response.json(await customerPhoneReadiness(owner.accountId,z.guid().parse(params.get('screeningId'))),{headers});
 const id=z.guid().parse(params.get('id')),row=await getCustomerPhoneCall(id,owner.accountId);
 if(!row)return new Response(null,{status:404,headers});
 if(params.get('audio')==='1'){
  if(!customerPhoneAudioAvailable(row))return new Response(null,{status:404,headers});
  const p=customerPhoneProvider();if(p.account!==row.provider_account_sid)return new Response(null,{status:404,headers});
  const recording=customerPhoneRecordingReceipt(row,await p.recordings.getRecording(row.recording_sid!));
  if(!recording||recording.status!=='completed')return new Response(null,{status:404,headers});
  return new Response(new Uint8Array(await p.recordings.media(row.recording_sid!)),{headers:{...headers,'Content-Type':'audio/mpeg','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
 }
 const latest=await reconcileCustomerPhoneCall(row).catch(()=>row);
 return Response.json({id:latest.id,status:latest.state,parentSid:latest.parent_sid,connected:!!latest.recipient_answered_at,ended:!!latest.ended_at,costPending:!!latest.ended_at&&!latest.settled_at,audioAvailable:customerPhoneAudioAvailable(latest)},{headers});
 }catch{return new Response(null,{status:503,headers});}}
