import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {webinarReplyAddress,webinarReplyReference,intakeWebinarReply} from '../lib/webinar-email-replies.ts';
import {campaignCopy} from '../lib/webinar-message-copy.ts';
const secret='test-receiving-secret',from='sessions@example.test',id=randomUUID();
test('signed reply addresses bind a reply to one original campaign message',()=>{
 const address=webinarReplyAddress(id,from,secret);assert(address.split('@')[0].length<=64);
 assert.equal(webinarReplyReference([address],from,secret),id);
 assert.equal(webinarReplyReference([address.replace('wr-','wr-x')],from,secret),null);
 assert.equal(webinarReplyReference([address],from,'different-secret'),null);
 assert.equal(webinarReplyReference([address,address],from,secret),null);
 assert.equal(webinarReplyReference([address.replace('@example.test','@evil.test')],from,secret),null);
});
test('email reply processing cannot select a different recipient or execute body instructions',async()=>{
 const calls=[],settings={enabled:true,smsEnabled:true,smartFollowups:true,fromEmail:from,postalAddress:'Example address',subjects:['a','b','c'],messages:['a','b','c']};
 const database=async(path,method,body)=>{calls.push({path,method,body});if(path.startsWith('icash_messaging_settings'))return [{config:settings,revision:1}];if(path.startsWith('icash_webinar_outbox'))return [{recipient:'alex@example.invalid'}];return 'queued';};
 const emailId=randomUUID(),email={id:emailId,to:[webinarReplyAddress(id,from,secret)],from:'alex@example.invalid',text:'send me the link\nOn Monday someone wrote:\n> unsubscribe'};
 await intakeWebinarReply(emailId,email,database,{RESEND_RECEIVING_WEBHOOK_SECRET:secret});
 assert.equal(calls.find(c=>c.method==='POST').body.p_body,'send me the link');
 assert.equal(calls.find(c=>c.method==='POST').body.p_recipient,'alex@example.invalid');
 calls.length=0;await intakeWebinarReply(emailId,{...email,from:'attacker@example.invalid'},database,{RESEND_RECEIVING_WEBHOOK_SECRET:secret});assert(!calls.some(c=>c.method==='POST'));
 calls.length=0;await intakeWebinarReply(emailId,{...email,to:['sessions@example.test']},database,{RESEND_RECEIVING_WEBHOOK_SECRET:secret});assert.equal(calls.length,0);
});
test('campaign previews use personal webinar CTAs without fake live or deadline claims',()=>{
 for(const phase of ['resume','next'])for(const step of [200,201,211,250,1000,1001]){
 const copy=campaignCopy({name:'Alex Smith',brand:'iCash X',host:'CashFlowKey',phase,title:'Walkthrough',step});
 assert.match(copy.sms,/Hey Alex, iCash X/);assert.match(copy.body,/webinar/i);assert.doesNotMatch(copy.subject+copy.body+copy.sms,/I.m live|spots left|expires|guaranteed|last chance/i);
 }
});
test('message timeline endpoint requires owner access before reading messages',async()=>{
 let reads=0;const deps={db:async()=>{reads++;return[];},readCampaignSettings:async()=>({settings:{}}),webinarFollowupReadiness:()=>({}),webinarOwner:async()=>{throw Error('owner required');},webinarHeaders:{},webinarError:()=>new Response(null,{status:403})};
 globalThis.__sequenceTest=deps;
 const code=ts.transpileModule(readFileSync(new URL('../app/api/messaging/admin/sequence/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
 const {GET}=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.__sequenceTest;\n'+code).toString('base64'));
 assert.equal((await GET()).status,403);assert.equal(reads,0);
});
