import assert from 'node:assert/strict';
import {analyzeText,validateTextAnalysis,requestedHuman,safeTextReplies} from '../lib/text-ai-policy.ts';
const raw={action:'ask_price',reply:'What price did you have in mind?',summary:'Needs roof.',facts:[{kind:'condition',quote:'needs a roof'},{kind:'price',quote:'$100000'}]};
const result=validateTextAnalysis(raw,['It needs a roof']);assert.equal(result.facts.length,1);assert.equal(result.humanRequested,false);
assert(requestedHuman('Please call me tomorrow'));assert(requestedHuman('I want a real person'));assert(!requestedHuman('The house is vacant'));
assert.throws(()=>validateTextAnalysis({...raw,action:'send_contract'},['It needs a roof']));
for(const body of Object.values(safeTextReplies)){assert(body.length+47<=160);assert(/^[A-Za-z0-9 .,!?]+$/.test(body));}
let calls=0;await assert.rejects(()=>analyzeText({model:'fixture',context:{},messages:[]},'fixture',async()=>{calls++;throw Error();}));assert.equal(calls,1);
const response=await analyzeText({model:'fixture',context:{},messages:[{direction:'incoming',body:'It needs a roof'}]},'fixture',async(url,options)=>{
 assert.equal(url,'https://api.openai.com/v1/chat/completions');const body=JSON.parse(options.body);assert.equal(body.store,false);assert.equal(body.max_completion_tokens,800);assert.equal(body.response_format.json_schema.strict,true);
 return Response.json({id:'fixture',choices:[{finish_reason:'stop',message:{content:JSON.stringify(raw)}}],usage:{prompt_tokens:100,completion_tokens:20}});
});
assert.equal(response.analysis.facts.length,1);assert.equal(response.usage.prompt_tokens,100);
console.log('Text AI: quoted facts, human handoff, bounded prompts, strict output and no retries passed. No provider calls.');
const missed=validateTextAnalysis({...raw,action:'review',facts:[]},['Sorry I missed your call']);assert.equal(missed.action,'ask_callback');assert.equal(missed.callbackRequested,false);
assert.equal(validateTextAnalysis({...raw,facts:[]},['I missed your call. Stop texting me']).action,'review');
const ownershipMessage='Hi, is this David, the owner of 123 Main St?';
const model=async()=>Response.json({id:'fixture',choices:[{finish_reason:'stop',message:{content:JSON.stringify({...raw,action:'review',facts:[]})}}]});
const missedAfterOwner=await analyzeText({model:'fixture',context:{},messages:[{direction:'outgoing',body:ownershipMessage},{direction:'incoming',body:'Sorry I missed your call'}]},'fixture',model);
assert.equal(missedAfterOwner.analysis.action,'ask_callback');
const ownerOnly=await analyzeText({model:'fixture',context:{},messages:[{direction:'outgoing',body:ownershipMessage},{direction:'incoming',body:'Yes'}]},'fixture',async()=>Response.json({id:'fixture',choices:[{finish_reason:'stop',message:{content:JSON.stringify({...raw,facts:[]})}}]}));assert.equal(ownerOnly.analysis.action,'review');
