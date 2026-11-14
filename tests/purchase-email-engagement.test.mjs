import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {recordPurchaseEmailEngagement} from '../lib/purchase-access-email.ts';
import {verifyTitleWebhook,titleEmailAddress,titleReference} from '../lib/title-inbound-policy.ts';

const now=Date.parse('2026-11-14T18:00:00Z'),provider=randomUUID(),purchaseEmail=randomUUID();
const event={type:'email.opened',created_at:'2026-11-14T17:59:00Z',data:{email_id:provider,to:['buyer@example.invalid'],tags:{icash_purchase_email_id:purchaseEmail}}};
let calls=[];
const db=async(path,method,body)=>{calls.push({path,method,body});};
await recordPurchaseEmailEngagement(event,'msg_opened_1',db,now);
assert.deepEqual(calls,[{path:'rpc/icash_record_purchase_email_engagement',method:'POST',body:{p_event:'msg_opened_1',p_id:purchaseEmail,p_provider:provider,p_recipient:'buyer@example.invalid',p_kind:'opened',p_at:'2026-11-14T17:59:00.000Z'}}]);
calls=[];
await recordPurchaseEmailEngagement({...event,type:'email.clicked',data:{...event.data,tags:undefined}},'msg_clicked_1',db,now);
assert.equal(calls.length,1);assert.equal(calls[0].body.p_id,null,'Missing tag retains original provider-ID fallback');assert.equal(calls[0].body.p_kind,'clicked');
for(const invalid of [null,[],{},'email.opened',{...event,type:'email.delivered'},{...event,type:22},{...event,created_at:undefined},{...event,created_at:1794679140},{...event,created_at:'not-a-date'},{...event,created_at:'2026-11-14'},{...event,created_at:'2026-11-14T18:00:00'},{...event,created_at:'2026-13-14T18:00:00Z'},{...event,created_at:'1970-01-01T00:00:00Z'},{...event,created_at:'2026-11-14T18:05:01Z'},...[
 null,[],{}, {...event.data,email_id:'../other'}, {...event.data,email_id:42}, {...event.data,to:[]}, {...event.data,to:['buyer@example.invalid','second@example.invalid']}, {...event.data,to:'buyer@example.invalid'}, {...event.data,to:[null]}, {...event.data,to:['invalid']}, {...event.data,to:['buyer@example.invalid\r\nBcc:other@example.invalid']}, {...event.data,to:['a'.repeat(250)+'@example.invalid']}, {...event.data,tags:[]}, {...event.data,tags:null}, {...event.data,tags:{icash_purchase_email_id:42}}, {...event.data,tags:{icash_purchase_email_id:'bad'}}
].map(data=>({...event,data}))]){
 calls=[];await recordPurchaseEmailEngagement(invalid,'msg_invalid',db,now);assert.equal(calls.length,0,'Malformed or unrelated provider observations do not mutate');
}
for(const eventId of [undefined,null,42,'','x'.repeat(201),'msg_bad\n','msg bad']){calls=[];await recordPurchaseEmailEngagement(event,eventId,db,now);assert.equal(calls.length,0,'Reject malformed signed event identifier');}
await assert.rejects(()=>recordPurchaseEmailEngagement(event,'msg_retry',async()=>{throw Error('Receipt store unavailable');},now),/Receipt store unavailable/,'Database errors must reach the signed route for provider retry');

// Execute the real route with signature verification and isolated, non-sending dependencies.
const key='engagement-fixture-key-32-bytes!!',envKeys=['RESEND_RECEIVING_WEBHOOK_SECRET','RESEND_API_KEY','ICASH_TITLE_REPLY_EMAIL','ICASH_SUPPORT_EMAIL'];
const previous=Object.fromEntries(envKeys.map(name=>[name,process.env[name]]));
let failDatabase=false;
const unrelated=()=>assert.fail('An engagement observation cannot enter delivery, suppression, reply, or send handling');
const dependencies={recordPurchaseEmailEngagement,recordPurchaseEmailDelivery:unrelated,recordSupportCustomerDelivery:unrelated,recordSupportOwnerDelivery:unrelated,scheduleSupportOwnerNotifications:unrelated,intakeWebinarReply:unrelated,customerEmailDomains:()=>null,customerReplyReference:unrelated,NextResponse:{json:(body,options)=>Response.json(body,options)},db:async(...args)=>{if(failDatabase)throw Error('DB unavailable');return db(...args);},verifyTitleWebhook,titleEmailAddress,titleReference,intakeVerifiedSupportEmail:unrelated,recordCustomerUpdateDelivery:unrelated};
const fixtureKey='__purchaseEmailEngagementRouteFixture';
globalThis[fixtureKey]=dependencies;
const source=ts.transpileModule(readFileSync(new URL('../app/api/webhooks/title-email/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .*;\s*$/gm,'');
const route=await import('data:text/javascript;base64,'+Buffer.from(`const {${Object.keys(dependencies).join(',')}}=globalThis.${fixtureKey};\n${source}`).toString('base64'));
function request(observation,{bad=false}={}){
 const raw=JSON.stringify(observation),id='msg_signed_engagement',stamp=String(Math.floor(Date.now()/1000));
 const signature=createHmac('sha256',Buffer.from(key)).update(`${id}.${stamp}.${raw}`).digest('base64');
 return new Request('https://www.geticashx.com/api/webhooks/title-email',{method:'POST',headers:{'svix-id':id,'svix-timestamp':stamp,'svix-signature':bad?'v1,invalid':'v1,'+signature},body:raw});
}
try{
 process.env.RESEND_RECEIVING_WEBHOOK_SECRET='whsec_'+Buffer.from(key).toString('base64');process.env.RESEND_API_KEY='fixture';process.env.ICASH_TITLE_REPLY_EMAIL='title@example.invalid';delete process.env.ICASH_SUPPORT_EMAIL;
 for(const type of ['email.opened','email.clicked']){
  const observation={...event,type,created_at:new Date().toISOString()};
  calls=[];let response=await route.POST(request(observation,{bad:true}));assert.equal(response.status,400);assert.equal(calls.length,0,'Unsigned observation cannot suppress a reminder');
  response=await route.POST(request(observation));assert.equal(response.status,200);assert.equal(calls.length,1);assert.equal(calls[0].path,'rpc/icash_record_purchase_email_engagement');assert.equal(calls[0].body.p_event,'msg_signed_engagement');
  calls=[];response=await route.POST(request({...observation,data:{...observation.data,to:['malformed']}}));assert.equal(response.status,200);assert.equal(calls.length,0);
  failDatabase=true;response=await route.POST(request(observation));assert.equal(response.status,503,'Failed engagement persistence remains retriable');failDatabase=false;
 }
 console.log('PASS purchase email engagement: bounded signed observation validation; optional tag/provider fallback; no delivery or sending side effects; rejected signatures; retriable storage failure. No live messages.');
}finally{
 delete globalThis[fixtureKey];for(const [name,value] of Object.entries(previous)){if(value===undefined)delete process.env[name];else process.env[name]=value;}
}
