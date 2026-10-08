import {createHash,createHmac} from 'node:crypto';
import {db} from '@/lib/stripe-test';
import {boundedBytes,createRecordingProviders} from '@/lib/required-call-recording-provider';
import {verifiedTwilioForm,object,sid,uuid} from '@/lib/required-call-recording';
import {twilioUsdChargeMicros} from '@/lib/twilio-usd-cost';
export const customerPhoneBase='https://www.geticashx.com/api/customer-phone';
export const customerPhoneRecordingPolicy='customer-phone-recorded-v1';
const terminal=new Set(['completed','failed','busy','no-answer','canceled']);
const phone=(n:string)=>/^\+1[2-9]\d{9}$/.test(n);
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const xml=(s:string)=>s.replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]!));
export type CustomerPhoneCall={id:string;account_id:string;actor_id:string;screening_id:string;callback_phone:string;recipient_phone:string;business_phone:string;provider_account_sid:string;nonce_hash:string;state:string;parent_sid:string|null;child_sid:string|null;connected_at:string|null;ended_at:string|null;created_at:string;parent_receipt:unknown;child_receipt:unknown;settled_at:string|null;max_seconds:number;recording_required:boolean;recording_sid:string|null;recording_receipt:unknown;recording_state:string;recording_expires_at:string|null;recording_deleted_at:string|null};
export function customerPhoneQuote(raw:unknown,to:string,from:string){
 const q=object(raw),prices=q.outbound_call_prices;
 if(q.destination_number!==to||q.origination_number!==from||q.iso_country!=='US'||String(q.price_unit).toUpperCase()!=='USD'||!Array.isArray(prices)||!prices.length)throw Error('PHONE_PRICE_UNAVAILABLE');
 const amounts=prices.map(p=>{const n=object(p).current_price;if(typeof n!=='string'||!/^\d+(?:\.\d{1,6})?$/.test(n))throw Error('PHONE_PRICE_UNAVAILABLE');return Math.round(Number(n)*1e6);});
 const max=Math.max(...amounts);if(!Number.isSafeInteger(max)||max<=0||max>100000)throw Error('PHONE_PRICE_UNAVAILABLE');return max;
}
export function customerPhoneTwiml(c:CustomerPhoneCall,part:'answer'|'connect',nonce:string){
 const url=(p:string)=>xml(`${customerPhoneBase}/${p}?id=${c.id}&nonce=${nonce}`);
 if(part==='answer')return `<Response><Gather input="dtmf" numDigits="1" timeout="8" action="${url('connect')}" method="POST"><Say>Press 1 to connect to your seller.</Say></Gather><Hangup/></Response>`;
 return `<Response><Dial callerId="${xml(c.business_phone)}" timeout="25" timeLimit="570" answerOnBridge="true" record="do-not-record" action="${url('done')}" method="POST"><Number statusCallback="${url('child')}" statusCallbackMethod="POST" statusCallbackEvent="initiated ringing answered completed">${xml(c.recipient_phone)}</Number></Dial><Hangup/></Response>`;
}
export function customerPhoneProvider(env:NodeJS.ProcessEnv=process.env,fetcher:typeof fetch=fetch){
 const account=env.TWILIO_ACCOUNT_SID,secret=env.TWILIO_AUTH_TOKEN;
 if(!sid(account,'AC')||!secret)throw Error('PHONE_SETUP_REQUIRED');
 const authorization='Basic '+Buffer.from(account+':'+secret).toString('base64');
 async function read(url:string,body?:URLSearchParams){
  const r=await fetcher(url,{method:body?'POST':'GET',headers:{Authorization:authorization,...body?{'Content-Type':'application/x-www-form-urlencoded'}:{}},body:body?.toString(),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error(body?'PHONE_PROVIDER_OUTCOME_UNKNOWN':'PHONE_PROVIDER_UNAVAILABLE');
  return object(JSON.parse((await boundedBytes(r,262144)).toString('utf8')));
 }
 const base=`https://api.twilio.com/2010-04-01/Accounts/${account}`;
 return {account,secret,recordings:createRecordingProviders(env,fetcher),
  callerId:async(number:string)=>{const owned=await read(base+'/IncomingPhoneNumbers.json?'+new URLSearchParams({PhoneNumber:number,PageSize:'2'}));if(Array.isArray(owned.incoming_phone_numbers)&&owned.incoming_phone_numbers.some(n=>object(n).phone_number===number&&object(n).account_sid===account))return true;const verified=await read(base+'/OutgoingCallerIds.json?'+new URLSearchParams({PhoneNumber:number,PageSize:'100'}));return Array.isArray(verified.outgoing_caller_ids)&&verified.outgoing_caller_ids.some(n=>object(n).phone_number===number&&object(n).account_sid===account);},
  price:(to:string,from:string)=>read('https://pricing.twilio.com/v2/Voice/Numbers/'+encodeURIComponent(to)+'?'+new URLSearchParams({OriginationNumber:from})),
  call:(id:string)=>{if(!sid(id,'CA'))throw Error('PHONE_CALL_REQUIRED');return read(base+'/Calls/'+id+'.json');},
  children:(id:string)=>{if(!sid(id,'CA'))throw Error('PHONE_CALL_REQUIRED');return read(base+'/Calls.json?'+new URLSearchParams({ParentCallSid:id,PageSize:'10'}));},
  dial:(c:CustomerPhoneCall,nonce:string)=>{if(!c.recording_required)throw Error('PHONE_RECORDING_SETUP_REQUIRED');return read(base+'/Calls.json',new URLSearchParams({From:c.business_phone,To:c.callback_phone,Url:`${customerPhoneBase}/answer?id=${c.id}&nonce=${nonce}`,Method:'POST',Timeout:'25',TimeLimit:'600',Record:'true',RecordingChannels:'dual',RecordingTrack:'both',Trim:'do-not-trim',RecordingStatusCallback:`${customerPhoneBase}/recording?id=${c.id}&nonce=${nonce}`,RecordingStatusCallbackMethod:'POST',RecordingStatusCallbackEvent:'completed absent',StatusCallback:`${customerPhoneBase}/status?id=${c.id}&nonce=${nonce}`,StatusCallbackMethod:'POST',StatusCallbackEvent:'completed'}));},
 };
}
function nonceFor(id:string,secret:string){return createHmac('sha256',secret).update('customer-phone-v1\0'+id).digest('hex');}
export async function getCustomerPhoneCall(id:string,accountId?:string){
 const [row]=await db<CustomerPhoneCall[]>(`icash_customer_phone_calls?id=eq.${id}${accountId?'&account_id=eq.'+accountId:''}&select=*`);return row??null;
}
function bound(c:CustomerPhoneCall,r:Record<string,unknown>,child=false){
 return sid(r.sid,'CA')&&r.account_sid===c.provider_account_sid&&r.from===c.business_phone&&r.to===(child?c.recipient_phone:c.callback_phone)&&r.direction===(child?'outbound-dial':'outbound-api')&&(!child||r.parent_call_sid===c.parent_sid)&&Date.parse(String(r.date_created))>=Date.parse(c.created_at)-5000&&Date.parse(String(r.date_created))<=Date.parse(c.created_at)+120000;
}
function receipt(r:Record<string,unknown>){
 return {sid:r.sid,status:r.status,currency:'USD',costMicros:twilioUsdChargeMicros(r.price,r.price_unit),receiptHash:hash(JSON.stringify(r))};
}
/** Provider metadata, not a callback URL, binds playback and costs to this call. */
export function customerPhoneRecordingReceipt(c:CustomerPhoneCall,r:Record<string,unknown>){
 if(!c.recording_required||!sid(c.parent_sid,'CA')||!sid(r.sid,'RE')||c.recording_sid&&c.recording_sid!==r.sid||r.account_sid!==c.provider_account_sid||r.call_sid!==c.parent_sid||r.source!=='OutboundAPI'||r.channels!==2||!['completed','absent'].includes(String(r.status)))return null;
 const start=Date.parse(String(r.start_time)),duration=Number(r.duration);
 if(r.status==='completed'&&(!Number.isFinite(start)||start<Date.parse(c.created_at)-5000||start>Date.parse(c.created_at)+120000||!Number.isInteger(duration)||duration<1||duration>c.max_seconds+2))return null;
 const minutes=r.status==='completed'?Math.ceil(duration/60):0,providerCost=twilioUsdChargeMicros(r.price,r.price_unit);
 return {sid:r.sid,callSid:c.parent_sid,providerAccountSid:c.provider_account_sid,status:r.status,currency:'USD',costMicros:(minutes?(providerCost??minutes*2500):0)+minutes*500,recordingPriceEstimated:minutes>0&&providerCost===null,storagePriceEstimated:minutes>0,policy:customerPhoneRecordingPolicy,durationSeconds:minutes?duration:0,receiptHash:hash(JSON.stringify(r)),expiresAt:minutes?new Date(start+duration*1000+30*86400000).toISOString():null};
}
export function customerPhoneAudioAvailable(c:Pick<CustomerPhoneCall,'recording_required'|'recording_state'|'recording_sid'|'recording_deleted_at'|'recording_expires_at'>,now=Date.now()){
 return c.recording_required&&c.recording_state==='available'&&sid(c.recording_sid,'RE')&&!c.recording_deleted_at&&!!c.recording_expires_at&&Date.parse(c.recording_expires_at)>now;
}
export async function startCustomerPhoneCall(input:{accountId:string;userId:string;screeningId:string;phone:string;callbackPhone:string;requestKey:string}){
 const {accountId,userId,screeningId,callbackPhone,requestKey}=input;
 if(!phone(input.phone)||!phone(callbackPhone)||input.phone===callbackPhone)throw Error('PHONE_DIFFERENT_NUMBER_REQUIRED');
 const prior=await getCustomerPhoneCall(requestKey,accountId);if(prior){if(prior.actor_id!==userId||prior.screening_id!==screeningId||prior.callback_phone!==callbackPhone||prior.recipient_phone!==input.phone)throw Error('PHONE_REQUEST_CONFLICT');return {id:prior.id,status:prior.state};}
 const contacts=await db<{phone:string;blocked:boolean}[]>('rpc/icash_manual_contacts','POST',{p_account:accountId,p_screening:screeningId});
 if(!contacts.some(c=>c.phone===input.phone&&!c.blocked))throw Error('PHONE_CONTACT_UNAVAILABLE');
 const reason=await db<string|null>('rpc/icash_manual_contact_reason','POST',{p_account:accountId,p_screening:screeningId,p_phone:input.phone,p_channel:'voice'});if(reason)return {error:reason};
 const [deal]=await db<{id:string}[]>(`icash_deal_files?account_id=eq.${accountId}&screening_id=eq.${screeningId}&select=id&limit=1`);
 const [thread]=deal?await db<{sender:string}[]>(`icash_text_threads?account_id=eq.${accountId}&deal_id=eq.${deal.id}&recipient=eq.${encodeURIComponent(input.phone)}&retired_at=is.null&select=sender&limit=1`):[];
 if(!thread||!phone(thread.sender)||thread.sender===callbackPhone)throw Error('PHONE_SENDER_UNAVAILABLE');
 const p=customerPhoneProvider(),nonce=nonceFor(requestKey,p.secret);
 const [a,b,callerId]=await Promise.all([p.price(callbackPhone,thread.sender),p.price(input.phone,thread.sender),p.callerId(thread.sender)]);if(!callerId)throw Error('PHONE_SENDER_UNAVAILABLE');
 const quote={recordingPolicy:customerPhoneRecordingPolicy,currency:'USD',country:'US',from:thread.sender,callback:callbackPhone,recipient:input.phone,checkedAt:new Date().toISOString(),callbackMicrosPerMinute:customerPhoneQuote(a,callbackPhone,thread.sender),recipientMicrosPerMinute:customerPhoneQuote(b,input.phone,thread.sender),receiptHash:hash(JSON.stringify([a,b]))};
 const result=await db<{created?:boolean;call?:CustomerPhoneCall;error?:string;holdCents?:number}>('rpc/icash_begin_customer_phone_call','POST',{p_actor:userId,p_account:accountId,p_screening:screeningId,p_recipient:input.phone,p_callback:callbackPhone,p_id:requestKey,p_sender:thread.sender,p_provider_account:p.account,p_nonce_hash:hash(nonce),p_quote:quote});
 if(result.error)return {error:result.error};if(!result.call)throw Error('PHONE_SETUP_REQUIRED');if(!result.created)return {id:result.call.id,status:result.call.state};
 try{
  const call=await p.dial(result.call,nonce);if(!bound(result.call,call))throw Error('PHONE_PROVIDER_OUTCOME_UNKNOWN');
  await db(`icash_customer_phone_calls?id=eq.${requestKey}&account_id=eq.${accountId}&parent_sid=is.null`,'PATCH',{parent_sid:call.sid,state:'ringing',updated_at:new Date().toISOString()});
  return {id:requestKey,status:'ringing',holdCents:result.holdCents};
 }catch{await db(`icash_customer_phone_calls?id=eq.${requestKey}&account_id=eq.${accountId}&state=eq.dispatching`,'PATCH',{state:'needs_review',updated_at:new Date().toISOString()}).catch(()=>undefined);return {id:requestKey,status:'needs_review'};}
}
export async function reconcileCustomerPhoneCall(c:CustomerPhoneCall,p=customerPhoneProvider()){
 if(!c.parent_sid)return c;
 const parent=await p.call(c.parent_sid);if(!bound(c,parent))return c;
 let child:Record<string,unknown>|null=null,noChildReceipt:Record<string,unknown>|null=null;
 if(c.connected_at){const list=await p.children(c.parent_sid);if(!Array.isArray(list.calls)||list.next_page_uri||list.calls.length>1)return c;
  if(list.calls.length){child=object(list.calls[0]);if(!bound(c,child,true))return c;}else if(terminal.has(String(parent.status))&&Date.now()-Date.parse(String(parent.end_time))>30000){noChildReceipt={currency:'USD',costMicros:0,kind:'verified_empty_child_list_after_parent_end',receiptHash:hash(JSON.stringify(list))};}
 }
 const parentEnded=terminal.has(String(parent.status)),childEnded=child&&terminal.has(String(child.status));
 const patch:Record<string,unknown>={updated_at:new Date().toISOString()};
 if(noChildReceipt)patch.child_receipt=noChildReceipt;
 if(child){patch.child_sid=child.sid;if(childEnded)patch.child_receipt=receipt(child);}
 if(parentEnded){patch.parent_receipt=receipt(parent);if(!c.connected_at||childEnded||noChildReceipt){patch.ended_at=c.ended_at??new Date().toISOString();patch.state=child?.status==='completed'?'completed':'failed';}}
 if(parentEnded&&c.recording_required&&!c.recording_receipt&&!c.recording_deleted_at){
  const list=object(await p.recordings.listRecordings(c.parent_sid).catch(()=>null));
  if(Array.isArray(list.recordings)&&!list.next_page_uri&&list.recordings.length===1){
   const rec=customerPhoneRecordingReceipt(c,object(list.recordings[0]));
   if(rec)Object.assign(patch,{recording_sid:rec.sid,recording_receipt:rec,recording_state:rec.status==='completed'?'available':'absent',recording_expires_at:rec.expiresAt});
  }else if(Array.isArray(list.recordings)&&!list.next_page_uri&&!list.recordings.length&&parent.status!=='completed'&&Number(parent.duration)===0){
   Object.assign(patch,{recording_state:'absent',recording_receipt:{status:'absent',callSid:c.parent_sid,providerAccountSid:c.provider_account_sid,kind:'unanswered_parent_with_empty_recordings',currency:'USD',costMicros:0,policy:customerPhoneRecordingPolicy,receiptHash:hash(JSON.stringify({parent,list}))}});
  }
 }
 await db(`icash_customer_phone_calls?id=eq.${c.id}&account_id=eq.${c.account_id}`,'PATCH',patch);
 if(patch.ended_at)await db('rpc/icash_settle_customer_phone_call','POST',{p_id:c.id}).catch(()=>false);
 return await getCustomerPhoneCall(c.id,c.account_id)??c;
}
export async function customerPhoneWebhook(request:Request,part:string){
 const hangup=()=>new Response('<Response><Hangup/></Response>',{headers:{'Content-Type':'application/xml','Cache-Control':'no-store'}});
 try{
  const url=new URL(request.url),id=url.searchParams.get('id'),nonce=url.searchParams.get('nonce');
  if(!uuid(id)||!nonce||!/^[a-f0-9]{64}$/.test(nonce)||url.searchParams.size!==2||url.pathname!==`/api/customer-phone/${part}`||request.headers.get('content-type')?.split(';')[0]!=='application/x-www-form-urlencoded')return hangup();
  const p=customerPhoneProvider(),target=`${customerPhoneBase}/${part}?id=${id}&nonce=${nonce}`;
  const form=verifiedTwilioForm((await boundedBytes(request,16384)).toString('utf8'),request.headers.get('x-twilio-signature'),p.secret,target);
  if(!form||form.get('AccountSid')!==p.account||!sid(form.get('CallSid'),'CA'))return hangup();
  let c=await getCustomerPhoneCall(id);if(!c||c.provider_account_sid!==p.account||c.nonce_hash!==hash(nonce))return hangup();
  const providerCall=await p.call(form.get('CallSid')!);
  if(part==='child'){if(!bound(c,providerCall,true))return hangup();await reconcileCustomerPhoneCall(c,p);return hangup();}
  if(!bound(c,providerCall)||c.parent_sid&&c.parent_sid!==providerCall.sid)return hangup();
  if(!c.parent_sid){await db(`icash_customer_phone_calls?id=eq.${id}&parent_sid=is.null`,'PATCH',{parent_sid:providerCall.sid,state:'ringing',updated_at:new Date().toISOString()});c=(await getCustomerPhoneCall(id))!;}
  if(part==='status'||part==='done'||part==='recording'){await reconcileCustomerPhoneCall(c,p);return hangup();}
  if(c.ended_at||!['in-progress','ringing'].includes(String(providerCall.status)))return hangup();
  if(part==='answer'&&c.state==='ringing'&&!c.connected_at)return new Response(customerPhoneTwiml(c,'answer',nonce),{headers:{'Content-Type':'application/xml'}});
  if(part==='connect'&&form.get('Digits')==='1'&&await db<boolean>('rpc/icash_connect_customer_phone_call','POST',{p_id:id,p_parent:c.parent_sid}))return new Response(customerPhoneTwiml(c,'connect',nonce),{headers:{'Content-Type':'application/xml'}});
  return hangup();
 }catch{return hangup();}
}

export async function maintainCustomerPhoneCalls(){
 const rows=await db<CustomerPhoneCall[]>(`icash_customer_phone_calls?settled_at=is.null&parent_sid=not.is.null&order=updated_at.asc&limit=3&select=*`);
 const outcomes=await Promise.allSettled(rows.map(c=>reconcileCustomerPhoneCall(c)));
 const expired=await db<CustomerPhoneCall[]>(`icash_customer_phone_calls?recording_sid=not.is.null&recording_deleted_at=is.null&recording_expires_at=lt.${encodeURIComponent(new Date().toISOString())}&order=recording_expires_at.asc&limit=3&select=*`);
 const deletions=await Promise.allSettled(expired.map(async c=>{
  const p=customerPhoneProvider();if(p.account!==c.provider_account_sid||!c.recording_sid)return false;
  const r=await p.recordings.getRecording(c.recording_sid,true);
  if(r.sid!==c.recording_sid||r.account_sid!==c.provider_account_sid||r.call_sid!==c.parent_sid)return false;
  if(r.status!=='deleted')await p.recordings.deleteRecording(c.recording_sid);
  await db(`icash_customer_phone_calls?id=eq.${c.id}&account_id=eq.${c.account_id}&recording_sid=eq.${c.recording_sid}`,'PATCH',{recording_state:'deleted',recording_deleted_at:new Date().toISOString()});
  return true;
 }));return {checked:outcomes.length,deleted:deletions.filter(x=>x.status==='fulfilled'&&x.value===true).length};
}

export async function customerPhoneReadiness(accountId:string,screeningId:string){
 const [deal]=await db<{id:string}[]>(`icash_deal_files?account_id=eq.${accountId}&screening_id=eq.${screeningId}&select=id&limit=1`);
 const [thread]=deal?await db<{sender:string;recipient:string}[]>(`icash_text_threads?account_id=eq.${accountId}&deal_id=eq.${deal.id}&retired_at=is.null&select=sender,recipient&limit=1`):[];
 if(!thread)return {ready:false,reason:'No saved business-number conversation.'};
 const p=customerPhoneProvider(),[price,caller]=await Promise.all([p.price(thread.recipient,thread.sender),p.callerId(thread.sender)]);
 const micros=customerPhoneQuote(price,thread.recipient,thread.sender);
 return {ready:caller,businessNumber:thread.sender,carrierPriceMicrosPerMinute:micros,checkedAt:new Date().toISOString()};
}
