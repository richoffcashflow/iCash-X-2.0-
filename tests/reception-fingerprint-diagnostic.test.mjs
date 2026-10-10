// Pure local fixtures. No provider requests or simulated conversations.
import test from 'node:test';
import assert from 'node:assert/strict';
import {canonical,sha} from '../lib/required-call-recording.ts';
import {diagnoseReceptionFingerprint} from '../scripts/reception-fingerprint-diagnostic.mjs';
const hash=value=>sha(JSON.stringify(canonical(value)));
const fixture=()=>({agent_id:'fixture',version_id:'fixture-version',conversation_config:{agent:{prompt:{prompt:'private fixture prompt',tools:[{name:'private tool A'},{name:'private tool B'},{name:'private tool C'}],tool_ids:['private ID A','private ID B']}}},platform_settings:{privacy:{record_voice:false}},workflow:null,procedures:null});

test('proves array-only drift against the original hash without modifying input or exposing values',()=>{
 const original=fixture(),input=structuredClone(original);
 input.conversation_config.agent.prompt.tools.reverse();
 const before=structuredClone(input),result=diagnoseReceptionFingerprint(input,hash(original));
 assert.equal(result.matched,true);assert.equal(result.exact,false);
 assert.equal(result.changes[0].path,'conversation_config.agent.prompt.tools');
 assert.deepEqual(result.changes[0].order,[2,1,0]);
 assert.deepEqual(input,before);assert(!JSON.stringify(result).includes('private'));
});

test('identifies jointly reordered tool lists while content and version changes still have no match',()=>{
 const original=fixture(),input=structuredClone(original),prompt=input.conversation_config.agent.prompt;
 prompt.tools.reverse();prompt.tool_ids.reverse();
 assert.equal(diagnoseReceptionFingerprint(input,hash(original)).changes.length,2);
 for(const mutate of [a=>a.version_id='different',a=>a.conversation_config.agent.prompt.prompt='different',a=>a.conversation_config.agent.prompt.tools[0].name='different']){
  const changed=structuredClone(input);mutate(changed);
  assert.equal(diagnoseReceptionFingerprint(changed,hash(original)).matched,false);
 }
});

test('reports field/null drift as evidence only and masks provider-controlled keys',()=>{
 const original=fixture(),input=structuredClone(original);
 input.platform_settings['private dynamic key']='private value';
 const result=diagnoseReceptionFingerprint(input,hash(original));
 assert.equal(result.matched,true);assert.equal(result.changes[0].kind,'remove_field');
 assert.equal(result.changes[0].path,'platform_settings.[unrecognized_key]');
 assert(!JSON.stringify(result).includes('private'));assert.equal('safe' in result,false);
 const nullable=fixture();nullable.platform_settings.privacy=null;
 assert.equal(diagnoseReceptionFingerprint(original,hash(nullable)).changes[0].kind,'restore_null');
});

test('bounds work, recognizes exact inputs, and cannot approve an unknown fingerprint',()=>{
 const input=fixture();
 assert.deepEqual(diagnoseReceptionFingerprint(input,hash(input)),{matched:false,exact:true,attempts:0,truncated:false,changes:[]});
 const huge=fixture();huge.platform_settings.extra=Array.from({length:1500},(_,i)=>({field:i}));
 const result=diagnoseReceptionFingerprint(huge,'0'.repeat(64));
 assert.equal(result.matched,false);assert(result.attempts<=8192);
 assert.equal(diagnoseReceptionFingerprint(input,'invalid').matched,false);
});

test('identifies a single numeric setting while changed tool content remains unmatched',()=>{
 const original=fixture(),input=structuredClone(original);
 original.platform_settings.call_limits={agent_concurrency_limit:10};
 input.platform_settings.call_limits={agent_concurrency_limit:15};
 const before=structuredClone(input),result=diagnoseReceptionFingerprint(input,hash(original));
 assert.equal(result.matched,true);
 assert.deepEqual(result.changes,[{kind:'restore_numeric_setting',path:'platform_settings.call_limits.agent_concurrency_limit',restoredValue:10}]);
 assert.deepEqual(input,before);
 input.conversation_config.agent.prompt.tools[0].name='different';
 assert.equal(diagnoseReceptionFingerprint(input,hash(original)).matched,false);
});

test('identifies a repeated schema default or a changed empty representation against the full original hash',()=>{
 const original=fixture(),input=structuredClone(original);
 for(const tool of input.conversation_config.agent.prompt.tools)tool.is_omitted=false;
 const result=diagnoseReceptionFingerprint(input,hash(original));
 assert.equal(result.matched,true);assert.equal(result.changes.length,3);
 assert(result.changes.every(change=>change.kind==='remove_field'&&change.path.endsWith('.is_omitted')));
 const empty=fixture();empty.platform_settings.privacy={};
 assert.equal(diagnoseReceptionFingerprint(original,hash(empty)).matched,true);
 const altered=structuredClone(input);altered.version_id='changed';
 assert.equal(diagnoseReceptionFingerprint(altered,hash(original)).matched,false);
});

test('proves optional expanded tool materialization while keeping the complete authoritative IDs',()=>{
 const current=fixture(),original=structuredClone(current);
 original.conversation_config.agent.prompt.tools=[current.conversation_config.agent.prompt.tools[2]];
 const result=diagnoseReceptionFingerprint(current,hash(original));
 assert.equal(result.matched,true);assert.equal(result.changes[0].kind,'expanded_tool_projection');
 assert.deepEqual(result.changes[0].retainedIndices,[2]);
 const before=structuredClone(current);current.conversation_config.agent.prompt.tool_ids.push('additional');
 assert.equal(diagnoseReceptionFingerprint(current,hash(original)).matched,false);
 assert.equal(before.conversation_config.agent.prompt.tools.length,3);
 const empty=fixture(),nullable=structuredClone(empty);empty.platform_settings.privacy=[];nullable.platform_settings.privacy=null;
 assert.equal(diagnoseReceptionFingerprint(nullable,hash(empty)).matched,true);
});
