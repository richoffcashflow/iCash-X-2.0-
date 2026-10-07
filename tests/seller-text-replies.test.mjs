import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {replyToSellerText} from '../lib/seller-text-replies.ts';
let result=null,calls=[];
const db=async(path,method,body)=>{assert.equal(path,'rpc/icash_prepare_seller_text_event');assert.equal(method,'POST');assert.deepEqual(body,{p_event:'signed-provider-event'});return result;};
const text=async(a,id)=>{calls.push(['sms',a,id]);return {status:'message_accepted'};};
const ai=async(a,id)=>{calls.push(['ai',a,id]);return {status:'message_accepted'};};
assert.equal((await replyToSellerText(db,text,'signed-provider-event',ai)).status,'no_seller_reply');assert.equal(calls.length,0);
result={accountId:'database-bound-account',messageId:'database-bound-message'};
assert.equal((await replyToSellerText(db,text,'signed-provider-event',ai)).status,'message_accepted');assert.deepEqual(calls,[['sms',result.accountId,result.messageId]]);
calls=[];result={accountId:'database-bound-account',textAiJobId:'database-bound-job'};
assert.equal((await replyToSellerText(db,text,'signed-provider-event',ai)).status,'message_accepted');assert.deepEqual(calls,[['ai',result.accountId,result.textAiJobId]],'AI job cannot receive an arbitrary account or message');
// Execute the actual route with provider/database stand-ins. Authentication must
// precede ingestion; STOP must never reach either reply engine.
let verified=true,event={id:'event-1',type:'text.incoming.sms',optOut:false,data:{to:'+12145550001',from:'+12145550002'}};
let effects=[];
const deps={NextResponse:{json:(body,o={})=>new Response(JSON.stringify(body),{status:o.status??200})},verifyContiguityWebhook:()=>verified,parseTextWebhook:()=>event,
 db:async(path)=>{effects.push(path);return path.startsWith('icash_text_senders')?[{phone:event.data.to}]:null;},ownerPracticeReply:async()=>effects.push('practice'),replyToSellerText:async()=>effects.push('seller'),dispatchTextMessage:()=>{},processTextAi:()=>{}};
globalThis.__sellerTextWebhook=deps;
const source=ts.transpileModule(readFileSync(new URL('../app/api/webhooks/contiguity/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
const {POST}=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.__sellerTextWebhook;\n'+source).toString('base64'));delete globalThis.__sellerTextWebhook;
process.env.CONTIGUITY_WEBHOOK_SECRET='simulation-only';
const req=()=>new Request('https://example.invalid/api/webhooks/contiguity',{method:'POST',body:'{}'});
verified=false;assert.equal((await POST(req())).status,401);assert.deepEqual(effects,[]);
verified=true;assert.equal((await POST(req())).status,200);assert.ok(effects.indexOf('rpc/icash_ingest_text_event')<effects.indexOf('seller'));assert.ok(effects.includes('practice'));
effects=[];event={...event,optOut:true};assert.equal((await POST(req())).status,200);assert.ok(effects.includes('rpc/icash_ingest_text_event'));assert.ok(!effects.includes('seller'));assert.ok(!effects.includes('practice'));
effects=[];event={...event,type:'text.delivery.confirmed',optOut:false};assert.equal((await POST(req())).status,200);assert.ok(!effects.includes('seller'));
console.log('Seller reply service and actual webhook: signature-first, event-bound routing, immediate dispatch, bounded AI dispatch, STOP and delivery-event exclusions passed.');
