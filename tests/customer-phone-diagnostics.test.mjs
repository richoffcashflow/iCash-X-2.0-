import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {object,sid,uuid,verifiedTwilioForm} from '../lib/required-call-recording.ts';
import {twilioUsdChargeMicros} from '../lib/twilio-usd-cost.ts';
import {boundedBytes,createRecordingProviders} from '../lib/required-call-recording-provider.ts';
const originalFetch=globalThis.fetch,originalWarn=console.warn,oldAccount=process.env.TWILIO_ACCOUNT_SID,oldSecret=process.env.TWILIO_AUTH_TOKEN;
const ac='AC'+'a'.repeat(32),ca='CA'+'b'.repeat(32),childSid='CA'+'c'.repeat(32),secret='synthetic-private-provider-secret',id='44444444-4444-4444-8444-444444444444',nonce='e'.repeat(64),created=new Date(Date.now()-60000).toISOString();
const base={id,account_id:'11111111-1111-4111-8111-111111111111',callback_phone:'client:icash_'+'a'.repeat(64),recipient_phone:'+12025550102',business_phone:'+12025550101',provider_account_sid:ac,nonce_hash:createHash('sha256').update(nonce).digest('hex'),connection_type:'browser',recording_required:false,max_seconds:600,created_at:created,state:'ringing',parent_sid:ca,ended_at:null,connected_at:null};
const parentBase={sid:ca,from:base.business_phone,to:base.callback_phone,account_sid:ac,direction:'outbound-api',date_created:created,status:'in-progress',price:'-0.004',price_unit:'USD'};
let row,parent,admission,logs,claims,reads,patches,settlements,providerError;
function reset(){row={...base};parent={...parentBase};admission=true;logs=[];claims=0;reads=0;patches=[];settlements=0;providerError=false;}
const db=async(path,method='GET',body)=>{
 if(path.startsWith('icash_customer_phone_calls?')){if(method==='PATCH'){patches.push(body);Object.assign(row,body);}return [{...row}];}
 if(path==='rpc/icash_connect_customer_phone_call'){claims++;if(admission==='throw')throw Error(secret+' '+base.recipient_phone);return admission&&row.state==='ringing'&&!row.connected_at&&!row.ended_at&&Date.parse(row.created_at)>=Date.now()-120000;}
 if(path==='rpc/icash_settle_customer_phone_call'){settlements++;return true;}
 throw Error('Unexpected fixture database action');
};
try{
 process.env.TWILIO_ACCOUNT_SID=ac;process.env.TWILIO_AUTH_TOKEN=secret;
 console.warn=(...args)=>logs.push(args);
 globalThis.fetch=async(url)=>{reads++;assert.equal(url,`https://api.twilio.com/2010-04-01/Accounts/${ac}/Calls/${ca}.json`);if(providerError)throw Error(secret+' '+base.recipient_phone);return Response.json(parent);};
 const m=await loadService('lib/customer-phone.ts',{createHash,createHmac,db,boundedBytes,createRecordingProviders,verifiedTwilioForm,object,sid,uuid,twilioUsdChargeMicros});
 const request=(part='answer',{valid=true,token=nonce,params={},contentType='application/x-www-form-urlencoded'}={})=>{
  const url=`${m.customerPhoneBase}/${part}?id=${id}&nonce=${token}`,form={AccountSid:ac,CallSid:ca,...params};
  const signature=createHmac('sha1',secret).update(url+Object.keys(form).sort().map(k=>k+form[k]).join('')).digest('base64');
  return new Request(url,{method:'POST',headers:{'Content-Type':contentType,'x-twilio-signature':valid?signature:'invalid'},body:new URLSearchParams(form)});
 };
 const run=async(part='answer',options={})=>(await m.customerPhoneWebhook(request(part,options),part)).text();
 function rejected(stage,reason,identified=true){assert.equal(logs.length,1);assert.deepEqual(logs[0],['customer_phone_webhook_rejected',{stage,reason,...identified?{callId:id}:{}}]);const serialized=JSON.stringify(logs);for(const privateValue of [secret,nonce,base.recipient_phone,base.callback_phone,ca,ac,'https://'])assert(!serialized.includes(privateValue),'No private provider/request material in logs');assert.equal(claims,stage==='bridge_admission'?1:0);}
 reset();assert.match(await run(),/<Dial/);assert.equal(claims,1);assert.equal(logs.length,0);
 reset();admission=false;assert.doesNotMatch(await run(),/<Dial/);rejected('bridge_admission','bridge_not_admitted');
 reset();admission='throw';assert.doesNotMatch(await run(),/<Dial/);rejected('bridge_admission','exception');
 reset();assert.doesNotMatch(await run('answer',{valid:false}),/<Dial/);rejected('signature','invalid_signature',false);assert.equal(reads,0);
 reset();assert.doesNotMatch(await run('answer',{token:'d'.repeat(64)}),/<Dial/);rejected('binding','invalid_call_binding',false);assert.equal(reads,0);
 reset();assert.doesNotMatch(await run('answer',{contentType:'text/plain'}),/<Dial/);rejected('validation','invalid_request',false);assert.equal(reads,0);
 reset();assert.doesNotMatch(await run('answer',{params:{AccountSid:'AC'+'f'.repeat(32)}}),/<Dial/);rejected('binding','invalid_provider_identity',false);assert.equal(reads,0);
 reset();parent.to='+12025550999';assert.doesNotMatch(await run(),/<Dial/);rejected('parent_binding','invalid_parent_binding');
 reset();row.parent_sid='CA'+'f'.repeat(32);assert.doesNotMatch(await run(),/<Dial/);rejected('parent_binding','invalid_parent_binding');
 reset();providerError=true;assert.doesNotMatch(await run(),/<Dial/);rejected('provider_call_read','exception');
 for(const state of ['dispatching','needs_review']){
  reset();row.state=state;assert.match(await run(),/<Dial/);assert.equal(claims,1);
  assert.equal(patches[0].state,'ringing','A canonical live signed callback recovers an incomplete dispatch receipt');
  assert.equal(logs.length,0);
 }
 reset();row.state='needs_review';row.created_at=new Date(Date.now()-180000).toISOString();parent.date_created=row.created_at;
 assert.doesNotMatch(await run(),/<Dial/);assert.equal(patches.length,0,'An expired parent cannot resume');
 reset();row.state='needs_review';row.ended_at=created;assert.doesNotMatch(await run(),/<Dial/);assert.equal(patches.length,0,'Ended calls cannot resume');
 reset();assert.doesNotMatch(await run('connect',{params:{Digits:'1'}}),/<Dial/);rejected('transition','unexpected_transition');
 reset();row.ended_at=created;assert.doesNotMatch(await run(),/<Dial/);assert.equal(logs.length,0);
 reset();row.connection_type='phone';assert.doesNotMatch(await run('connect',{params:{Digits:'2'}}),/<Dial/);assert.equal(logs.length,0);
 // Reconciliation must discover provider children even when the bridge receipt
 // has not reached connected_at. All provider identities and list bounds remain.
 const child={...parentBase,sid:childSid,to:base.recipient_phone,direction:'outbound-dial',parent_call_sid:ca,status:'completed',duration:'15'};
 let childReads=0;
 const reconcile=async(list)=>m.reconcileCustomerPhoneCall({...row},{call:async()=>parent,children:async()=>{childReads++;return list;}});
 reset();parent.status='completed';await reconcile({calls:[child]});assert.equal(row.child_sid,childSid);assert.equal(row.state,'completed');assert.equal(settlements,1);assert.equal(childReads,1);
 for(const mismatch of [{to:'+12025550999'},{account_sid:'AC'+'d'.repeat(32)},{parent_call_sid:'CA'+'d'.repeat(32)},{from:'+12025550999'},{date_created:new Date(Date.parse(created)-5001).toISOString()},{date_created:new Date(Date.parse(created)+120001).toISOString()}]){reset();parent.status='completed';await reconcile({calls:[{...child,...mismatch}]});assert.equal(patches.length,0);assert.equal(settlements,0);}
 for(const list of [{calls:[child],next_page_uri:'/next'},{calls:[child,child]},{calls:null}]){reset();parent.status='completed';await reconcile(list);assert.equal(patches.length,0);assert.equal(settlements,0);}
 reset();parent.status='completed';parent.end_time=new Date(Date.now()-10000).toISOString();await reconcile({calls:[]});assert.equal(row.ended_at,null);assert.equal(settlements,0);
 reset();parent.status='completed';parent.end_time=new Date(Date.now()-31000).toISOString();await reconcile({calls:[]});assert.equal(row.state,'failed');assert.equal(row.child_receipt.kind,'verified_empty_child_list_after_parent_end');assert.equal(settlements,1);
 reset();parent.status='completed';await reconcile({calls:[]});assert.equal(row.ended_at,null);assert.equal(settlements,0,'Missing parent end time cannot establish grace period');
 reset();parent.status='completed';await reconcile({calls:[{...child,status:'in-progress'}]});assert.equal(row.ended_at,null);assert.equal(settlements,0);assert.equal(row.child_sid,childSid);
 // Successful status/done/recording callbacks normally return Hangup, not a rejection.
 for(const part of ['status','done','recording']){reset();globalThis.fetch=async(url)=>url.includes('Calls.json?')?Response.json({calls:[]}):Response.json(parent);assert.doesNotMatch(await run(part),/<Dial/);assert.equal(logs.length,0);}
 originalWarn('PASS manual call diagnostics: signed bridge admission, safe static rejection stages, fail-closed identity/nonce/parent gates, child discovery without connected_at, exact child bounds, pagination ambiguity, grace period and normal Hangup callbacks.');
}finally{globalThis.fetch=originalFetch;console.warn=originalWarn;if(oldAccount===undefined)delete process.env.TWILIO_ACCOUNT_SID;else process.env.TWILIO_ACCOUNT_SID=oldAccount;if(oldSecret===undefined)delete process.env.TWILIO_AUTH_TOKEN;else process.env.TWILIO_AUTH_TOKEN=oldSecret;}
