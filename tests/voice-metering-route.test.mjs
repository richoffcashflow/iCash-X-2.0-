import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {validVoiceMeterToken} from '../lib/voice-live-metering.ts';
let claims=0,failure=false;
const token='11111111-1111-4111-8111-111111111111'.repeat(2),url='https://www.geticashx.com/api/internal/voice/metering';
const deps={validVoiceMeterToken,db:async()=>{throw Error('UNEXPECTED_DATABASE');},createRecordingProviders:()=>({}),processVoiceMeterTicket:async value=>{assert.equal(value,token);claims++;if(failure)throw Error('synthetic');return {status:'funded',httpStatus:200};}};
globalThis.__meterRoute=deps;
const source=ts.transpileModule(readFileSync(new URL('../app/api/internal/voice/metering/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .*;\s*$/gm,'');
const {POST}=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.__meterRoute;\n'+source).toString('base64'));
try{
 for(const [authorization,target,body] of [[token,url],['Bearer broken',url],['Bearer '+token,url+'?account=other'],['Bearer '+token,url,'{}'],['Basic '+token,url]]){
  const r=await POST(new Request(target,{method:'POST',headers:{authorization},...(body?{body}:{})}));assert.equal(r.status,401);
 }
 assert.equal(claims,0);
 const request=()=>new Request(url,{method:'POST',headers:{authorization:'Bearer '+token}});
 let r=await POST(request());assert.equal(r.status,200);assert.deepEqual(await r.json(),{status:'funded'});assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(claims,1);
 failure=true;r=await POST(request());assert.equal(r.status,503);assert.deepEqual(await r.json(),{status:'metering_review_required'});assert.equal(claims,2,'no retry on uncertain result');
}finally{delete globalThis.__meterRoute;}
console.log('PASS metering route: exact UUID-pair Bearer capability, no body/query, private response, failed operation not replayed; all transports mocked.');
