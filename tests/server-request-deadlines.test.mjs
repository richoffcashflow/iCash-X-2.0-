import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
function load(path,deps){const module={exports:{}};const code=ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','module','exports',code)(name=>{assert(name in deps,'Unexpected dependency '+name);return deps[name];},module,module.exports);return module.exports;}
const originalFetch=globalThis.fetch,originalTimeout=AbortSignal.timeout;
const originalURL=process.env.SUPABASE_URL,originalKey=process.env.SUPABASE_SECRET_KEY;
const keepAlive=setInterval(()=>{},1000);
let cookiesChanged=0,requests=0,signals=[];
const stalled=signal=>new Promise((_,reject)=>{if(signal.aborted)return reject(signal.reason);signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
try{
 process.env.SUPABASE_URL='https://fixture.invalid';process.env.SUPABASE_SECRET_KEY='synthetic';
 const auth=load('lib/account-auth.ts',{'next/headers':{cookies:async()=>({get:name=>({icash_access:{value:'fixture-access'},icash_refresh:{value:'fixture-refresh'}}[name]),set(){cookiesChanged++;},delete(){cookiesChanged++;}})},'@/lib/stripe-test':{db(){throw Error('Unexpected database request');}},'@/lib/account-mode':{accountMode:()=> 'live'},'@/lib/purchase-phone-access':{accessHash:x=>x,phoneSessionCookie:'phone'}});
 globalThis.fetch=async(_url,init)=>{requests++;signals.push(init.signal);await stalled(init.signal);};
 const cancel=new AbortController();const pending=auth.currentUser(true,cancel.signal);await new Promise(r=>setTimeout(r,5));cancel.abort();await assert.rejects(pending);
 assert.equal(requests,1,'Timeout does not replay auth or refresh');assert.equal(cookiesChanged,0,'An outage must not sign the customer out');assert(signals[0].aborted);
 const deadlines=[];AbortSignal.timeout=ms=>{deadlines.push(ms);return originalTimeout(ms>1000?30:ms);};
 let accountSignal,mediaSignal,accountDelay=0,deny=false,mediaCalls=0;
 const audio=load('app/api/work/recording/audio/route.ts',{'@/lib/work-account':{workAccount:async({signal})=>{accountSignal=signal;if(deny)throw Error('SIGN_IN_REQUIRED');await new Promise(r=>setTimeout(r,accountDelay));signal.throwIfAborted();return {accountId:'owned'};}},'@/lib/required-call-recording-server':{recordingServer:signal=>({audio:async account=>{assert.equal(account,'owned');mediaCalls++;mediaSignal=signal;await stalled(signal);}})},'@/lib/required-call-recording':{uuid:id=>id==='fixture',privateHeaders:{'Cache-Control':'private, no-store'}}});
 accountDelay=20;let response=await audio.GET(new Request('https://fixture.invalid/?id=fixture'));
 assert.equal(response.status,503);assert.equal(accountSignal,mediaSignal,'Auth and media must spend one shared deadline');assert(mediaSignal.aborted);assert(deadlines.includes(25000));
 deny=true;response=await audio.GET(new Request('https://fixture.invalid/?id=fixture'));assert.equal(response.status,404);assert.equal(mediaCalls,1,'Denied accounts never read audio');
 deny=false;accountDelay=0;response=await audio.GET(new Request('https://fixture.invalid/?id=bad'));assert.equal(response.status,404);
 const {workspaceEventStream}=await import('../lib/workspace-event-stream.ts');
 const events=load('app/api/work/events/route.ts',{'@/lib/work-account':{workAccount:async({signal})=>{accountSignal=signal;await new Promise(r=>setTimeout(r,20));return {accountId:'owned'};}},'@/lib/stripe-test':{db:async(_p,_m,_b,signal)=>{mediaSignal=signal;await stalled(signal);}},'@/lib/workspace-event-stream':{workspaceEventStream}});
 response=await events.GET(new Request('https://fixture.invalid/events'));assert.equal(response.status,200);assert.equal((await response.body.getReader().read()).done,true);assert(accountSignal.aborted);assert(mediaSignal.aborted);assert(deadlines.includes(55000));
 console.log('Server deadlines: shared authentication/media/stream budgets, cancellation, preserved sessions and denied-tenant isolation passed.');
}finally{clearInterval(keepAlive);globalThis.fetch=originalFetch;AbortSignal.timeout=originalTimeout;if(originalURL===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=originalURL;if(originalKey===undefined)delete process.env.SUPABASE_SECRET_KEY;else process.env.SUPABASE_SECRET_KEY=originalKey;}
