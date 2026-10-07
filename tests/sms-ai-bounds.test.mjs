import assert from 'node:assert/strict';
import {analyzeText} from '../lib/text-ai-policy.ts';
let calls=0;
await assert.rejects(analyzeText({model:'gpt-4.1-mini',context:{text:'x'.repeat(45000)},messages:[]},'simulation',async()=>{calls++;throw Error('must not call provider');}),/CONTEXT_TOO_LARGE/);assert.equal(calls,0);
await analyzeText({model:'gpt-4.1-mini',context:{},messages:[{direction:'incoming',body:'The roof needs work'}]},'simulation',async(_url,init)=>{
 const body=JSON.parse(init.body);assert.equal(body.service_tier,'default');assert.equal(body.max_completion_tokens,800);assert.equal(body.store,false);assert.ok(Buffer.byteLength(init.body)<44000);
 return new Response(JSON.stringify({id:'chatcmpl-fixture',usage:{prompt_tokens:1000,completion_tokens:100},choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'ask_price',reply:'What price did you have in mind?',summary:'Seller stated roof needs work',facts:[{kind:'condition',quote:'The roof needs work'}]})}}]}),{status:200});
});
console.log('SMS AI request enforces reviewed byte/token envelope, default service tier and no oversized provider call.');
