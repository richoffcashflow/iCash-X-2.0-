import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes,webcrypto,createHash} from 'node:crypto';
import ts from 'typescript';
import {verifyTitleWebhook,titleEmailAddress,titleReference} from '../lib/title-inbound-policy.ts';
import {titleReplyOriginalSource} from '../lib/title-reply-source.ts';
const emailId='11111111-1111-4111-8111-111111111111',requestId='22222222-2222-4222-8222-222222222222';
const keyBytes=randomBytes(32),key=await webcrypto.subtle.importKey('raw',keyBytes,{name:'HMAC',hash:'SHA-256'},false,['sign']);
const priorEnv={...process.env},oldFetch=globalThis.fetch;
let records=[],fetches=0,duplicate=false;
const original={id:emailId,to:['title-reply@example.invalid'],from:'Closer <closer@example.invalid>',created_at:'2026-01-02T03:04:05.678Z',subject:`Re: [ICX-T:${requestId}]`,text:'Please send the executed purchase agreement.',authentication:{dmarc:'pass'}};
let email={...original};
const dependencies={
 NextResponse:{json:(body,init)=>Response.json(body,init)},verifyTitleWebhook,titleEmailAddress,titleReference,titleReplyOriginalSource,
 customerEmailDomains:()=>false,customerReplyReference:()=>null,intakeWebinarReply:async()=>false,intakeVerifiedSupportEmail:async()=>false,scheduleSupportOwnerNotifications:()=>{},
 db:async(path,method,body)=>{records.push({path,method,body});return path.startsWith('icash_title_replies?')&&duplicate?[{id:'existing'}]:[];},
 recordSupportCustomerDelivery:async()=>{},recordPurchaseEmailDelivery:async()=>{},recordPurchaseEmailEngagement:async()=>{},recordSupportOwnerDelivery:async()=>{},recordCustomerUpdateDelivery:async()=>{},
};
globalThis.__titleOriginalRoute=dependencies;
const source=ts.transpileModule(readFileSync('app/api/webhooks/title-email/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
const {POST}=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(dependencies).join(',')+'}=globalThis.__titleOriginalRoute;\n'+source).toString('base64'));
const request=async({tampered=false,age=0}={})=>{
 const body=JSON.stringify({type:'email.received',created_at:new Date().toISOString(),data:{email_id:emailId}}),stamp=String(Math.floor(Date.now()/1000)-age),id='fixture-authenticated-webhook';
 const signed=new TextEncoder().encode(`${id}.${stamp}.${body}`),signature=Buffer.from(await webcrypto.subtle.sign('HMAC',key,signed)).toString('base64');
 return new Request('https://fixture.invalid/api/webhooks/title-email',{method:'POST',headers:{'svix-id':id,'svix-timestamp':stamp,'svix-signature':'v1,'+signature},body:body+(tampered?' ':'')});
};
try{
 process.env.RESEND_RECEIVING_WEBHOOK_SECRET='whsec_'+keyBytes.toString('base64');process.env.RESEND_API_KEY='fixture-no-network';process.env.ICASH_TITLE_REPLY_EMAIL='title-reply@example.invalid';delete process.env.ICASH_SUPPORT_EMAIL;
 globalThis.fetch=async(url,options)=>{fetches++;assert.equal(url,'https://api.resend.com/emails/receiving/'+emailId);assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert(options.signal instanceof AbortSignal);return {ok:true,json:async()=>email};};
 assert.equal((await POST(await request())).status,200);
 let record=records.find(r=>r.path==='rpc/icash_record_title_reply_source');assert(record);
 assert.equal(record.body.p_email,emailId);assert.equal(record.body.p_reference,requestId);assert.equal(record.body.p_sender,'closer@example.invalid');assert.equal(record.body.p_authenticated,true);
 assert.equal(record.body.p_source.providerReceivedAt,original.created_at,'Provider original time survives a new webhook delivery');
 assert.equal(record.body.p_source.webhookEventId,'fixture-authenticated-webhook');assert.equal(record.body.p_source.bodyComplete,true);assert.equal(record.body.p_source.bodySha256,createHash('sha256').update(original.text).digest('hex'));
 email={...original,text:'Please send the purchase agreement.'+' '.repeat(20000)+'But do not send it until approval.'};records=[];
 await POST(await request());record=records.find(r=>r.path==='rpc/icash_record_title_reply_source');assert.equal(record.body.p_text.length,20000);assert.equal(record.body.p_source.bodyComplete,false);assert.equal(record.body.p_source.bodySha256,null);
 email={...original,created_at:undefined,text:undefined,authentication:{dmarc:'fail'}};records=[];
 await POST(await request());record=records.find(r=>r.path==='rpc/icash_record_title_reply_source');assert.equal(record.body.p_source.providerReceivedAt,null);assert.equal(record.body.p_source.bodyComplete,false);assert.equal(record.body.p_authenticated,false);
 for(const bad of [{...original,id:requestId},{...original,to:['other@example.invalid']}]){email=bad;records=[];await POST(await request());assert(!records.some(r=>r.path.startsWith('rpc/icash_record_title_reply')));}
 email=original;duplicate=true;records=[];const before=fetches;await POST(await request());assert.equal(fetches,before);assert(!records.some(r=>r.path.startsWith('rpc/')));duplicate=false;
 for(const options of [{tampered:true},{age:600}]){records=[];const before=fetches;assert.equal((await POST(await request(options))).status,400);assert.equal(fetches,before);assert.equal(records.length,0);}
 console.log('PASS title source route: real signature verification, original provider time, exact ID/mailbox binding, pre-cap completeness, unchanged quarantine and retry boundaries. No provider calls.');
}finally{
 globalThis.fetch=oldFetch;delete globalThis.__titleOriginalRoute;
 for(const name of ['RESEND_RECEIVING_WEBHOOK_SECRET','RESEND_API_KEY','ICASH_TITLE_REPLY_EMAIL','ICASH_SUPPORT_EMAIL']){if(priorEnv[name]===undefined)delete process.env[name];else process.env[name]=priorEnv[name];}
}
