import assert from 'node:assert/strict';
import {prepareTitleCopyDelivery} from '../lib/title-copy-delivery.ts';
globalThis.fetch=async()=>{throw Error('No network');};
const document=(kind,id)=>({kind,envelopeId:id,sourceHash:'a'.repeat(64),pdfSource:{id,accountId:'account',dealId:'deal',kind,state:'completed',testMode:false,providerId:'101',terms:{},termsHash:'original',templateId:'template',recipients:[],createdAt:'2026-01-01T00:00:00Z'}});
const purchase=document('purchase','11111111-1111-4111-8111-111111111111'),assignment=document('assignment','22222222-2222-4222-8222-222222222222');
let source={status:'ready',documents:[purchase,assignment]},reads=[];
const d={db:async(path,method,args)=>{assert.equal(path,'rpc/icash_prepare_title_copy');assert.equal(method,'POST');assert.deepEqual(args,{p_account:'account',p_task:'task',p_payload:{type:'executed_copy'}});return source;},pdf:async(account,id,audit,expected)=>{assert.equal(account,'account');assert.equal(audit,false);assert.deepEqual(expected,[purchase,assignment].find(d=>d.envelopeId===id).pdfSource);reads.push(id);return new Uint8Array([37,80,68,70]);}};
const run=()=>prepareTitleCopyDelivery('account','task',{type:'executed_copy'},d);
let result=await run();assert.equal(result.status,'ready');assert.equal(result.attachments.length,2);assert.deepEqual(reads,[purchase.envelopeId,assignment.envelopeId]);assert.match(result.details,/terms are unchanged/);
for(const held of [null,{status:'covered_by_original_receipt'}]){source=held;reads=[];result=await run();assert.equal(result.status,held?'covered':'held');assert.equal(reads.length,0);}
for(const docs of [[],[purchase,purchase],[{...purchase,kind:'payoff'}],[{...purchase,envelopeId:'wrong'}],[{...purchase,pdfSource:null}],[{...purchase,pdfSource:{...purchase.pdfSource,accountId:'other'}}]]){source={status:'ready',documents:docs};await assert.rejects(run());}
source={status:'ready',documents:[purchase,assignment]};d.pdf=async()=>new Uint8Array(11*1024*1024);await assert.rejects(run(),/attachment requires review/);
d.pdf=async()=>new Uint8Array(0);await assert.rejects(run(),/attachment requires review/);
d.pdf=async()=>new Uint8Array([37,80,68,70]).buffer;assert.equal((await run()).attachments[0].content,'JVBERg==');
d.pdf=async()=>{throw Error('Read-only PDF unavailable');};assert.equal((await run()).status,'retry');
d.db=async()=>{throw Error('Prepare temporarily unavailable');};assert.equal((await run()).status,'retry');
console.log('PASS title copy preparation: only exact executed documents, no PDF read for linked receipts/holds, combined byte cap before final claim.');
