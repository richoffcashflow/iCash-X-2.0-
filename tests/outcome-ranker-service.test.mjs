import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {runOutcomeRanker} from '../lib/outcome-ranker-service.ts';
import {authorizeOutboundBilling} from '../lib/outbound-billing-service.ts';
const token='00000000-0000-4000-8000-000000000001';
let calls=[];
const database=async(path,method,body)=>{calls.push(path);if(path.endsWith('claim_ranker_training'))return {token,asOf:new Date().toISOString(),samples:[]};assert.equal(body.p_token,token);assert.equal(body.p_result.status,'collecting');return true;};
assert.equal((await runOutcomeRanker(database)).status,'collecting');
assert.deepEqual(calls,['rpc/icash_claim_ranker_training','rpc/icash_finish_ranker_training']);
assert.equal((await runOutcomeRanker(async()=>null)).status,'idle');
await assert.rejects(runOutcomeRanker(async(path)=>path.endsWith('claim_ranker_training')?{token,asOf:new Date().toISOString(),samples:[]}:false),/receipt not confirmed/);
await assert.rejects(runOutcomeRanker(async()=>({token,samples:[]})));
let touched=false;await assert.rejects(runOutcomeRanker(async()=>{touched=true;},AbortSignal.abort()));assert.equal(touched,false);
const previous=process.env.CRON_SECRET;process.env.CRON_SECRET='s'.repeat(40);
try{
 let runs=0;
 globalThis.__rankerRoute={authorizeOutboundBilling,db:{},runOutcomeRanker:async()=>{runs++;return {status:'collecting'};}};
 const source=ts.transpileModule(readFileSync(new URL('../app/api/internal/learning/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
 const {GET}=await import('data:text/javascript;base64,'+Buffer.from('const {authorizeOutboundBilling,db,runOutcomeRanker}=globalThis.__rankerRoute;\n'+source).toString('base64'));
 assert.equal((await GET(new Request('https://example.com/api/internal/learning'))).status,401);assert.equal(runs,0);
 assert.equal((await GET(new Request('https://example.com/api/internal/learning?token=bad',{headers:{authorization:`Bearer ${process.env.CRON_SECRET}`}}))).status,401);
 const response=await GET(new Request('https://example.com/api/internal/learning',{headers:{authorization:`Bearer ${process.env.CRON_SECRET}`}}));
 assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(runs,1);
}finally{if(previous===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=previous;delete globalThis.__rankerRoute;}
console.log('Outcome ranker service: authenticated bounded cron, no provider operations, durable result receipt and aborted work passed.');
