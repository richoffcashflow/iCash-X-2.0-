import {replyToInstantLeadText} from '../lib/meta-instant-text.ts';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {verifyContiguityWebhook,parseTextWebhook,isServiceTextSender} from '../lib/contiguity.ts';
import {suppressCarrierBlockedSms} from '../lib/carrier-blocked-sms.ts';

const sender='+12125550101',recipient='+12125550102',secret='fixture-carrier-block-secret';
const event={id:'fixture-carrier-block',type:'text.delivery.failed',timestamp:Date.now(),data:{
 from:sender,to:recipient,message_id:'fixture-outgoing',
 error:'Free Msg: Receiver 12125550102 unable to receive message - Message Blocking is active'
}};
let known=true,suppressions=new Set(),effects=[],insertFailure=false,cancelFailure=false,insertRace=false;
let queue=[];
function reset(){
 known=true;suppressions=new Set();effects=[];insertFailure=false;cancelFailure=false;insertRace=false;
 queue=[
  {channel:'sms',recipient,state:'pending'},
  {channel:'sms',recipient,state:'claimed'},
  {channel:'sms',recipient,state:'sending'},
  {channel:'email',recipient:'fixture@example.invalid',state:'pending'},
  {channel:'sms',recipient:'+12125550103',state:'pending'}
 ];
}
const db=async(path,method,body)=>{
 effects.push({path,method,body});
 if(path.startsWith('icash_text_senders?'))return [];
 if(path.startsWith('icash_webinar_text_senders?'))return known?[{phone:sender}]:[];
 if(path.startsWith('icash_webinar_phone_suppressions?')){
  assert.equal(path,`icash_webinar_phone_suppressions?phone=eq.${encodeURIComponent(recipient)}&select=phone`);
  return suppressions.has(recipient)?[{phone:recipient}]:[];
 }
 if(path==='icash_webinar_phone_suppressions'){
  assert.deepEqual(body,{phone:recipient});assert.equal(method,'POST');
  if(insertFailure)throw Error('Database unavailable');
  if(insertRace){suppressions.add(recipient);throw Error('Concurrent primary key insertion');}
  assert(!suppressions.has(recipient));suppressions.add(recipient);return [body];
 }
 if(path.startsWith('icash_webinar_outbox?')){
  assert.equal(path,`icash_webinar_outbox?channel=eq.sms&recipient=eq.${encodeURIComponent(recipient)}&state=in.(pending,claimed)`);
  assert.equal(method,'PATCH');
  if(cancelFailure)throw Error('Cancellation unavailable');
  assert(suppressions.has(recipient),'Admission must stop before queue cleanup');
  for(const job of queue)if(job.channel==='sms'&&job.recipient===recipient&&['pending','claimed'].includes(job.state))Object.assign(job,body);
  return [];
 }
 if(path==='rpc/icash_webinar_followup_delivery')return null;
 throw Error('Unexpected side effect: '+path);
};
const noProvider=()=>{throw Error('Fixtures must not contact a provider or generate a customer reply');};
const deps={replyToInstantLeadText,NextResponse:{json:Response.json},verifyContiguityWebhook,parseTextWebhook,isServiceTextSender,suppressCarrierBlockedSms,db,
 ownerPracticeReply:noProvider,replyToSellerText:noProvider,dispatchTextMessage:noProvider,processTextAi:noProvider,dispatchLiveVoice:noProvider};
globalThis.__carrierBlock=deps;
const source=ts.transpileModule(readFileSync(new URL('../app/api/webhooks/contiguity/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
const {POST}=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.__carrierBlock;\n'+source).toString('base64'));
delete globalThis.__carrierBlock;
process.env.CONTIGUITY_WEBHOOK_SECRET=secret;
function request(value=event,key=secret){
 const raw=JSON.stringify(value),stamp=Math.floor(Date.now()/1000);
 const signature=createHmac('sha256',key).update(stamp+'.').update(raw).digest('hex');
 return new Request('https://example.invalid/api/webhooks/contiguity',{method:'POST',body:raw,headers:{'contiguity-signature':`t=${stamp},v1=${signature}`}});
}
const receipts=()=>effects.filter(e=>e.path==='rpc/icash_webinar_followup_delivery');

reset();
assert.equal(parseTextWebhook(event).data.error,event.data.error,'Provider failure detail survives validation');
assert.equal((await POST(request())).status,200);
assert(suppressions.has(recipient));
assert.deepEqual(queue.map(j=>j.state),['canceled','canceled','sending','pending','pending'],'Cancel queued texts only; emails, other recipients and in-flight sends are preserved');
assert.equal(receipts()[0].body.p_kind,'suppressed');
assert.equal((await POST(request())).status,200,'Webhook replay is idempotent');
assert.equal(effects.filter(e=>e.path==='icash_webinar_phone_suppressions').length,1);
assert.equal((await POST(request({...event,type:'text.delivery.confirmed'}))).status,200);
assert(suppressions.has(recipient),'A later success cannot lift recipient suppression');

for(const error of [undefined,null,400,{message:'Message Blocking is active'},'Carrier never provided delivery confirmation. Your message may have delivered, but Contiguity has no idea if it did.','Request timed out','Carrier unavailable','Message rejected']){
 reset();assert.equal((await POST(request({...event,data:{...event.data,error}}))).status,200);
 assert.equal(suppressions.size,0,'Uncertain/generic failures must not become recipient blocks');
 assert.equal(receipts()[0].body.p_kind,'failed');
 assert(queue.every(j=>j.state!=='canceled'));
}
for(const type of ['text.delivery.confirmed','text.cancelled']){
 reset();assert.equal((await POST(request({...event,type}))).status,200);assert.equal(suppressions.size,0);
}
reset();
assert.equal((await POST(request(event,'wrong-secret'))).status,401);assert.deepEqual(effects,[]);
known=false;
assert.equal((await POST(request())).status,400);assert.equal(suppressions.size,0);

reset();insertRace=true;
assert.equal((await POST(request())).status,200,'Concurrent suppression writes are harmless');
assert(suppressions.has(recipient));assert.equal(queue[0].state,'canceled');
reset();insertFailure=true;
assert.equal((await POST(request())).status,503,'Failed persistence asks for webhook redelivery');
assert.equal(receipts().length,0);assert.equal(suppressions.size,0);assert.equal(queue[0].state,'pending');
insertFailure=false;
assert.equal((await POST(request())).status,200);assert(suppressions.has(recipient));
reset();cancelFailure=true;
assert.equal((await POST(request())).status,503);assert(suppressions.has(recipient),'Suppression survives a partial queue-cleanup failure');
assert.equal(receipts().length,0);
cancelFailure=false;
assert.equal((await POST(request())).status,200);assert.equal(queue[0].state,'canceled');

reset();
assert.equal(await suppressCarrierBlockedSms(db,parseTextWebhook({...event,type:'text.incoming.sms',data:{from:recipient,to:sender,body:event.data.error,error:event.data.error}})),false,'Inbound text cannot declare a carrier block');
assert.deepEqual(effects,[]);
console.log('Carrier-blocked SMS: signed known sender, explicit failure only, durable suppression, queue cancellation, email preservation, replay/concurrency and partial failure recovery passed.');
