import assert from 'node:assert/strict';
import {sellerVoiceTurnConfig,sellerVoiceTurnConfigMatches} from '../lib/seller-voice-turn-policy.ts';

// The former preparation policy produced the same automatic filler whenever
// generation crossed two seconds, even if the answer needed no acknowledgment.
const prior={turn_eagerness:'eager',turn_timeout:7,turn_model:'turn_v3',spelling_patience:'auto',speculative_turn:false,
 soft_timeout_config:{timeout_seconds:2,message:'One moment.',use_llm_generated_message:false,max_soft_timeouts_per_generation:1,disable_until_first_user_message:true},
 interruption_ignore_terms:[],silence_end_call_timeout:-1,transcribe_on_disabled_interruptions:false};
const untouched=structuredClone(prior),next=sellerVoiceTurnConfig(prior);
assert(!sellerVoiceTurnConfigMatches(prior));
assert(sellerVoiceTurnConfigMatches(next));
assert.deepEqual(prior,untouched,'Building a candidate never mutates the active/saved source');
assert.notEqual(next.soft_timeout_config,prior.soft_timeout_config);
assert.deepEqual(next,{...untouched,turn_eagerness:'normal',turn_timeout:10,soft_timeout_config:{...untouched.soft_timeout_config,timeout_seconds:-1}},'Only the three reviewed fields change');
assert.deepEqual(sellerVoiceTurnConfig(next),next,'Reconciliation produces the same candidate without widening the change');
for(const soft of [undefined,null,[],false,'unexpected']){
 const source={turn_model:'turn_v3',soft_timeout_config:soft};
 const prepared=sellerVoiceTurnConfig(source);
 assert.deepEqual(prepared.soft_timeout_config,{timeout_seconds:-1});
 assert(sellerVoiceTurnConfigMatches(prepared));
}
for(const change of [{turn_eagerness:'eager'},{turn_timeout:2},{soft_timeout_config:{timeout_seconds:2}},{soft_timeout_config:null},{soft_timeout_config:[]},{soft_timeout_config:{timeout_seconds:'-1'}}])assert(!sellerVoiceTurnConfigMatches({...next,...change}),'Candidate readback cannot retain recurring fillers or premature silence prompts');
assert(sellerVoiceTurnConfigMatches(sellerVoiceTurnConfig()));
console.log('PASS seller voice turn candidate: removes automatic filler, normal turn-taking, ten-second silence recovery, exact unrelated-setting preservation and readback rejection. No provider calls or audio-quality claims.');
