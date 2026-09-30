import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
let kind='discovery', alertFailure=true, alertCalls=0;
const records=[], signals=[];
process.env.ICASH_ATTENTION_EMAIL_ENABLED='true';
const mocks={
  NextResponse:{json:(body,options={})=>({body,status:options.status??200})},
  db:async(path,_method,body)=>{records.push({path,body}); if(path==='rpc/icash_consume_automation')return {id:'ticket',accountId:'account',kind};return null;},
  discoverForAccount:async()=>({status:'screening_queued'}),
  readVoiceUsagePolicies:()=>[],reconcileLiveConversation:async()=>({}),
  settlePendingVoiceUsage:async(...args)=>{signals.push(args[4]);return {status:'settled'};},
  dispatchAttentionNotification:async(account,{signal})=>{assert.equal(account,'account');signals.push(signal);alertCalls++;if(alertFailure)throw Error('Provider unavailable');return {status:'attention_idle'};},
};
globalThis.__attentionAutomation=mocks;
let source=ts.transpileModule(readFileSync(new URL('../app/api/internal/automation/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
source='const {'+Object.keys(mocks).join(',')+'}=globalThis.__attentionAutomation;\n'+source;
const {POST}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const request=()=>new Request('https://example.com/api/internal/automation',{method:'POST',headers:{authorization:'Bearer '+('00000000-0000-0000-0000-000000000000').repeat(2)}});
let result=await POST(request()); assert.equal(result.status,200);assert.equal(result.body.status,'screening_queued'); assert.equal(alertCalls,1);
let finishes=records.filter(x=>x.path==='rpc/icash_finish_automation');assert.equal(finishes.length,1);assert.equal(finishes[0].body.p_success,true,'Notification failure cannot rewrite primary work');assert.equal(signals[0],signals[1],'Alerts share existing deadline');
kind='customer_attention';alertFailure=false;records.length=0;alertCalls=0;
result=await POST(request());assert.equal(result.status,200);assert.equal(result.body.status,'attention_idle');assert.equal(alertCalls,1,'Dedicated ticket cannot trigger a second alert attempt');assert.equal(records.find(x=>x.path==='rpc/icash_finish_automation').body.p_success,true);
kind='discovery';process.env.ICASH_ATTENTION_EMAIL_ENABLED='false';alertCalls=0;await POST(request());assert.equal(alertCalls,0,'Feature off makes no notification call');
delete globalThis.__attentionAutomation;
console.log('Attention automation: primary work survives provider faults, shared deadline, one attempt per ticket and default-off integration passed. No external calls.');
