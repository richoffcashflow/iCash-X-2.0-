import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {db as database} from '../lib/stripe-test.ts';
import {elevenRequest} from '../lib/elevenlabs.ts';
const savedFetch=globalThis.fetch;
process.env.SUPABASE_URL='https://database.example.invalid';process.env.SUPABASE_SECRET_KEY='fixture';process.env.ELEVENLABS_API_KEY='fixture';
try{
 const controller=new AbortController();let actualSignal;
 globalThis.fetch=async(_url,options)=>{actualSignal=options.signal;controller.abort();assert.equal(actualSignal.aborted,true);actualSignal.throwIfAborted();};
 await assert.rejects(database('fixture',undefined,undefined,controller.signal),{name:'AbortError'});
 const providerController=new AbortController();
 await assert.rejects(elevenRequest('/fixture',undefined,async(_url,options)=>{providerController.abort();assert.equal(options.signal.aborted,true);options.signal.throwIfAborted();},providerController.signal),/VOICE_UNREACHABLE/);
}finally{globalThis.fetch=savedFetch;}
// The route's billing-only abort must preserve the primary action's success and finish record.
const records=[];let deadlines=[];
const db=async(path,_method,body)=>{
 records.push({path,body});
 if(path==='rpc/icash_consume_automation')return {id:'ticket',accountId:'account',kind:'discovery'};
 return true;
};
globalThis.__billingRoute={
 db,NextResponse:{json:(body,options)=>({body,options})},readVoiceUsagePolicies:()=>[],
 discoverForAccount:async()=>({status:'screening_queued'}),reconcileLiveConversation:async()=>({}),
 settlePendingVoiceUsage:async(_db,account,_policies,_reconcile,signal)=>{assert.equal(account,'account');assert(signal instanceof AbortSignal);throw new DOMException('Timed out','TimeoutError');},
};
let source=ts.transpileModule(readFileSync(new URL('../app/api/internal/automation/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
source='const {db,NextResponse,readVoiceUsagePolicies,discoverForAccount,reconcileLiveConversation,settlePendingVoiceUsage}=globalThis.__billingRoute;\n'+source;
const {POST}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const originalTimeout=AbortSignal.timeout;
try{
 AbortSignal.timeout=ms=>{deadlines.push(ms);return originalTimeout(ms);};
 const response=await POST(new Request('https://example.invalid/api/internal/automation',{method:'POST',headers:{authorization:'Bearer '+('00000000-0000-0000-0000-000000000000').repeat(2)}}));
 assert.equal(response.body.status,'screening_queued');assert.deepEqual(response.body.billing,{status:'review_required'});
 assert.deepEqual(deadlines,[45000]);
 const finish=records.filter(r=>r.path==='rpc/icash_finish_automation');
 assert.equal(finish.length,1);assert.deepEqual(finish[0].body,{p_id:'ticket',p_success:true,p_outcome:'screening_queued'});
}finally{AbortSignal.timeout=originalTimeout;delete globalThis.__billingRoute;}
console.log('PASS: billing cancellation reaches DB/provider; primary automation success survives billing timeout');
