import {smsLength} from '../lib/sms-length.ts';
import * as textSendState from '../lib/text-send-state.ts';
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import ts from 'typescript';
const require=createRequire(import.meta.url),mod={exports:{}};const source=readFileSync(new URL('../components/deal-messages.tsx',import.meta.url),'utf8').replace('function TextComposer(','export function TextComposer(');const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
new Function('require','module','exports',code)(name=>name==='react'?{useState:()=>[0,()=>{}]}:name==='./workspace-view'?{}:name==='@/lib/sms-length'?{smsLength}:name==='@/lib/text-send-state'?textSendState:require(name),mod,mod.exports);
let takenOver=0,calls=[],finish,response={status:'message_accepted',manual:true},savedDraft=null;globalThis.fetch=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});await new Promise(r=>finish=r);return Response.json(response);};const attempts={},props={thread:{id:'seller',party:'seller',paused:false},message:'Hello',setMessage:m=>savedDraft=m,onSent(){},onTakeover(){takenOver++},attempts,stale:false},event={preventDefault(){}};
const form=mod.exports.TextComposer(props);const first=form.props.onSubmit(event);await form.props.onSubmit(event);assert.equal(calls.length,1,'Same-frame submit locked');assert.equal(calls[0].body.threadId,'seller');assert(calls[0].body.requestKey);finish();await first;assert.equal(savedDraft,'');assert.equal(takenOver,1,'accepted customer text confirms lead takeover');
response={status:'held',manual:true};const second=mod.exports.TextComposer({...props,thread:{id:'buyer',party:'buyer',paused:false}}).props.onSubmit(event);finish();await second;assert.equal(attempts.buyer.held,true);assert.equal(takenOver,2,'saved human text takes over even if delivery is held');await mod.exports.TextComposer({...props,thread:{id:'buyer',paused:false}}).props.onSubmit(event);assert.equal(calls.length,2,'Returning to a held contact cannot resend');
for(const update of [{stale:true},{thread:{id:'paused',paused:true,manualReply:false}},{thread:{id:'empty-wallet',paused:true,manualReply:true,sendReason:'Add credits to send.'}},{message:'x'.repeat(161)},{message:'🌟'.repeat(36)}])await mod.exports.TextComposer({...props,...update}).props.onSubmit(event);assert.equal(calls.length,2,'Stale, blocked and over-limit drafts do not send');
console.log('PASS conversation sends: contact-specific request keys, same-frame duplicate lock, held state survives contact changes, stale/permission/length limits.');

const manualForm=mod.exports.TextComposer({...props,thread:{id:'manual',paused:true,manualReply:true}});response={status:'message_accepted',manual:true};const manualSend=manualForm.props.onSubmit(event);finish();await manualSend;assert.equal(calls.length,3,'paused bot still permits manual conversation');

response={status:'message_not_sent',notSent:true,state:'ready',error:'Spending allowance reached.'};
const retryProps={...props,thread:{id:'retry',paused:false}};
const failed=mod.exports.TextComposer(retryProps).props.onSubmit(event);finish();await failed;
const originalKey=attempts.retry.key;assert.equal(attempts.retry.held,false);assert.equal(attempts.retry.retryable,true);
response={status:'message_accepted',manual:true};const retry=mod.exports.TextComposer(retryProps).props.onSubmit(event);finish();await retry;
assert.equal(calls.at(-1).body.requestKey,originalKey,'a known unstarted message reuses its original idempotency key');
