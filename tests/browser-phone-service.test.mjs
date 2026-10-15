import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {object,sid,uuid,verifiedTwilioForm} from '../lib/required-call-recording.ts';
import {twilioUsdChargeMicros} from '../lib/twilio-usd-cost.ts';
import {boundedBytes,createRecordingProviders} from '../lib/required-call-recording-provider.ts';
const originalFetch=globalThis.fetch,oldAccount=process.env.TWILIO_ACCOUNT_SID,oldSecret=process.env.TWILIO_AUTH_TOKEN;
const ac='AC'+'a'.repeat(32),ca='CA'+'b'.repeat(32),child='CA'+'c'.repeat(32),secret='fixture-auth-token-for-browser',account='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',screen='33333333-3333-4333-8333-333333333333',id='44444444-4444-4444-8444-444444444444',business='+12025550101',recipient='+12025550102',callback='client:icash_'+'a'.repeat(64),created=new Date().toISOString();
let row=null,dials=0,claims=0,reads=0;
const parent={sid:ca,from:business,to:callback,account_sid:ac,direction:'outbound-api',date_created:created,status:'in-progress'};
try{
 process.env.TWILIO_ACCOUNT_SID=ac;process.env.TWILIO_AUTH_TOKEN=secret;
 globalThis.fetch=async(url,options={})=>{reads++;if(url.includes('pricing.twilio.com')){assert(!url.includes('client'),'Browser leg does not use PSTN number pricing');return Response.json({destination_number:recipient,origination_number:business,iso_country:'US',price_unit:'USD',outbound_call_prices:[{current_price:'0.014'}]});}
  if(url.includes('IncomingPhoneNumbers.json'))return Response.json({incoming_phone_numbers:[{phone_number:business,account_sid:ac}]});
  if(url.endsWith('/Calls.json')&&options.method==='POST'){dials++;const body=new URLSearchParams(options.body);assert.equal(body.get('To'),callback);assert.equal(body.get('From'),business);assert.equal(body.get('Record'),'true');assert.equal(body.get('RecordingChannels'),'dual');assert.equal(body.get('TimeLimit'),'600');return Response.json(parent);}
  if(url.endsWith('/Calls/'+ca+'.json'))return Response.json(parent);
  if(url.endsWith('/Calls/'+child+'.json'))return Response.json({...parent,sid:child,to:recipient,direction:'outbound-dial',parent_call_sid:ca});
  throw Error('Unexpected fixture provider request '+url);
 };
 const db=async(path,method='GET',body)=>{
  if(path.startsWith('icash_customer_phone_calls?')){if(method==='PATCH'){Object.assign(row,body);return [row];}return path.includes('account_id=eq.other')?[]:row?[row]:[];}
  if(path==='rpc/icash_manual_contacts')return [{phone:recipient,blocked:false}];
  if(path==='rpc/icash_manual_contact_reason')return null;
  if(path==='rpc/icash_customer_call_sender'){assert.deepEqual(body,{p_account:account,p_screening:screen,p_recipient:recipient});return business;}
  if(path==='rpc/icash_begin_customer_phone_call'){assert.equal(body.p_quote.connectionType,'browser');assert.equal(body.p_quote.callbackMicrosPerMinute,4000);row={id,account_id:account,actor_id:actor,screening_id:screen,callback_phone:callback,recipient_phone:recipient,business_phone:business,provider_account_sid:ac,nonce_hash:body.p_nonce_hash,connection_type:'browser',recording_required:true,max_seconds:600,created_at:created,state:'dispatching',parent_sid:null,ended_at:null,connected_at:null};return {created:true,call:{...row}};}
  if(path==='rpc/icash_connect_customer_phone_call'){claims++;if(row.connected_at)return false;row.connected_at=created;row.state='connecting';return true;}
  throw Error('Unexpected fixture database call '+path);
 };
 const m=await loadService('lib/customer-phone.ts',{createHash,createHmac,db,boundedBytes,createRecordingProviders,verifiedTwilioForm,object,sid,uuid,twilioUsdChargeMicros});
 const input={accountId:account,userId:actor,screeningId:screen,phone:recipient,callbackPhone:callback,requestKey:id,browser:true};
 const started=await m.startCustomerPhoneCall(input);assert.equal(started.parentSid,ca);assert.equal(dials,1);await m.startCustomerPhoneCall(input);assert.equal(dials,1,'Repeated start never dials twice');await assert.rejects(()=>m.endCustomerBrowserCall(id,'other'),/PHONE_CALL_REQUIRED/);
 const nonce=createHmac('sha256',secret).update('customer-phone-v1\0'+id).digest('hex');
 const request=(part,callSid=ca,valid=true,extra={})=>{const url=m.customerPhoneBase+'/'+part+'?id='+id+'&nonce='+nonce,params={AccountSid:ac,CallSid:callSid,...extra};const signature=createHmac('sha1',secret).update(url+Object.keys(params).sort().map(k=>k+params[k]).join('')).digest('base64');return new Request(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','x-twilio-signature':valid?signature:'invalid'},body:new URLSearchParams(params)});};
 const before=reads;assert(!(await (await m.customerPhoneWebhook(request('answer',ca,false),'answer')).text()).includes('<Dial'));assert.equal(reads,before,'Bad signature never reads provider state');
 const answer=await (await m.customerPhoneWebhook(request('answer'),'answer')).text();assert(answer.includes('<Dial'));assert(!answer.includes('<Gather'),'Browser skips the phone DTMF step');assert(answer.includes('callerId="'+business+'"'));assert(answer.includes('/notice?'));assert.equal(claims,1);
 assert(!(await (await m.customerPhoneWebhook(request('answer'),'answer')).text()).includes('<Dial'),'Connect receipt is single use');
 assert(!(await (await m.customerPhoneWebhook(request('connect',ca,true,{Digits:'1'}),'connect')).text()).includes('<Dial'),'Phone connect endpoint cannot replay a browser call');
 assert.match(await (await m.customerPhoneWebhook(request('notice',child),'notice')).text(),/being recorded/);
 console.log('PASS browser service: client destination, verified business caller ID, recorded bounded call, idempotent start, account scope, signed webhook, single-use direct connect and seller notice.');
}finally{globalThis.fetch=originalFetch;if(oldAccount===undefined)delete process.env.TWILIO_ACCOUNT_SID;else process.env.TWILIO_ACCOUNT_SID=oldAccount;if(oldSecret===undefined)delete process.env.TWILIO_AUTH_TOKEN;else process.env.TWILIO_AUTH_TOKEN=oldSecret;}
