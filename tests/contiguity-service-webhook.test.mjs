import {replyToInstantLeadText} from '../lib/meta-instant-text.ts';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {isServiceTextSender,parseTextWebhook,textPayload,verifyContiguityWebhook} from '../lib/contiguity.ts';
import {suppressCarrierBlockedSms} from '../lib/carrier-blocked-sms.ts';

const destination='+17208134296',secret='fixture-service-webhook-secret';
const fixture={id:'fixture-service-message',type:'text.incoming.sms',timestamp:Math.floor(Date.now()/1000),data:{from:'+22395',to:destination,body:'Synthetic service notice: do not persist or send to an AI.'}};
let registered=true,campaignOnly=false,effects=[],failurePath=null,diagnostics=[];
const deps={replyToInstantLeadText,NextResponse:{json:Response.json},verifyContiguityWebhook,parseTextWebhook,isServiceTextSender,suppressCarrierBlockedSms,
 console:{warn:(...args)=>diagnostics.push(args)},
 db:async(path,method,body)=>{
  if(path===failurePath)throw Error('PRIVATE provider error '+destination+' '+secret);
  effects.push({path,method,body});
  if(path.startsWith('icash_text_senders?'))return registered&&!campaignOnly?[{phone:destination}]:[];
  if(path.startsWith('icash_webinar_text_senders?'))return registered&&campaignOnly?[{phone:destination}]:[];
  if(path==='rpc/icash_route_lifecycle_text')return 'property';
  return null;
 },
 ownerPracticeReply:async()=>effects.push({path:'practice'}),
 replyToSellerText:async()=>effects.push({path:'seller'}),
 dispatchTextMessage:()=>{throw Error('No provider dispatch in fixtures');},
 processTextAi:()=>{throw Error('No AI request in fixtures');},
 dispatchLiveVoice:()=>{throw Error('No calling in fixtures');}
};
globalThis.__serviceWebhook=deps;
const source=ts.transpileModule(readFileSync(new URL('../app/api/webhooks/contiguity/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
const {POST}=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.__serviceWebhook;\n'+source).toString('base64'));
delete globalThis.__serviceWebhook;
process.env.CONTIGUITY_WEBHOOK_SECRET=secret;
function request(event=fixture,{key=secret,stamp=Math.floor(Date.now()/1000)}={}){
 const body=JSON.stringify(event),signature=createHmac('sha256',key).update(stamp+'.').update(body).digest('hex');
 return new Request('https://example.invalid/api/webhooks/contiguity',{method:'POST',body,headers:{'contiguity-signature':`t=${stamp},v1=${signature}`}});
}
for(const from of ['22395','+22395','123456','+123456']){
 for(const type of ['text.incoming.sms','text.incoming.mms','communications.incoming.sms','communications.incoming.mms','communications.incoming.imessage','imessage.incoming']){
  effects=[];
  const event={...fixture,type,data:{...fixture.data,from}};
  assert(isServiceTextSender(from));
  assert.equal(parseTextWebhook(event).data.from,from);
  assert.equal((await POST(request(event))).status,200);
  assert.deepEqual(effects.map(x=>x.path),[
   `icash_text_senders?phone=eq.${encodeURIComponent(destination)}&select=phone`,
   `icash_webinar_text_senders?phone=eq.${encodeURIComponent(destination)}&select=phone`
  ]);
  assert(effects.every(x=>x.method===undefined&&x.body===undefined),'Service content must not be written or sent to lifecycle/AI processing');
 }
}
effects=[];campaignOnly=true;
assert.deepEqual(await (await POST(request())).json(),{received:true});
assert.equal(effects.length,2,'Registered campaign numbers also acknowledge service messages');
assert.equal((await POST(request())).status,200,'Provider retries are harmless');
assert.equal(effects.length,4);campaignOnly=false;

for(const auth of [{key:'incorrect-fixture-secret'},{stamp:Math.floor(Date.now()/1000)-301}]){
 effects=[];assert.equal((await POST(request(fixture,auth))).status,401);assert.deepEqual(effects,[]);
}
effects=[];delete process.env.CONTIGUITY_WEBHOOK_SECRET;
assert.equal((await POST(request())).status,503);assert.deepEqual(effects,[]);
process.env.CONTIGUITY_WEBHOOK_SECRET=secret;
registered=false;effects=[];
assert.equal((await POST(request())).status,400,'Unknown destinations remain rejected');
assert.equal(effects.length,2);registered=true;

for(const from of ['+12','1234567','Twilio','+1-22395']){
 effects=[];assert.equal((await POST(request({...fixture,data:{...fixture.data,from}}))).status,400);assert.deepEqual(effects,[]);
}
for(const type of ['text.delivery.confirmed','text.delivery.failed','text.cancelled']){
 assert.throws(()=>parseTextWebhook({...fixture,type,data:{...fixture.data,message_id:'fixture-message'}}),'A short code is never an outgoing business sender');
}
assert.throws(()=>parseTextWebhook({...fixture,data:{...fixture.data,to:'22395'}}));
assert.throws(()=>textPayload({from:destination,to:'+22395',message:'No sends to short codes'}));
assert.throws(()=>textPayload({from:'+22395',to:destination,message:'No sends from short codes'}));

effects=[];
assert.equal((await POST(request({...fixture,data:{...fixture.data,from:'+12125550123',body:'STOP'}}))).status,200);
assert(effects.some(x=>x.path==='rpc/icash_ingest_text_event'),'Regular customer STOP messages still reach ingestion');
assert(!effects.some(x=>['practice','seller'].includes(x.path)),'STOP never triggers replies');
for(const type of ['communications.incoming.sms','communications.incoming.mms','communications.incoming.imessage','imessage.incoming']){
 const original={...fixture,type,data:{...fixture.data,from:'+12125550123',body:'STOP'}};
 const parsed=parseTextWebhook(original);
 assert.equal(parsed.type,type.endsWith('.mms')?'text.incoming.mms':'text.incoming.sms');
 assert.equal(parsed.optOut,true);assert.deepEqual(parsed.providerEvent,original,'Original receipt stays intact');
 effects=[];assert.equal((await POST(request(original))).status,200);
 const saved=effects.find(x=>x.path==='rpc/icash_ingest_text_event');assert(saved);
 assert(!effects.some(x=>['practice','seller'].includes(x.path)),'Aliases preserve STOP handling');
 effects=[];assert.equal((await POST(request(original,{key:'wrong'}))).status,401);assert.equal(effects.length,0);
 const image={...original,data:{...original.data,body:undefined,attachments:[{url:'https://example.invalid/fixture.jpg',mime:'image/jpeg'}]}};
 assert.equal(parseTextWebhook(image).data.attachments.length,1,'Attachment-only replies survive normalization');
}
diagnostics=[];failurePath='rpc/icash_ingest_text_event';
assert.equal((await POST(request({...fixture,data:{...fixture.data,from:'+12125550123',body:'STOP'}}))).status,503);
assert.deepEqual(diagnostics,[['text_webhook_processing_failed',{stage:'property_ingestion'}]],'Log only the fixed failure stage, never the source body, phone, secret or exception');
failurePath=null;diagnostics=[];
assert.equal((await POST(request({...fixture,type:'private-event-'+secret}))).status,400);
assert.deepEqual(diagnostics,[['text_webhook_rejected',{reason:'unsupported_or_malformed'}]]);
console.log('PASS signed short-code webhook: registered destination, no persistence/AI/replies, harmless retries, signature/replay checks, normal STOP handling and strict outbound numbers. Fixtures only.');
