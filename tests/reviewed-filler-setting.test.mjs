import assert from 'node:assert/strict';
import {canonical,matchesReviewedFillerSetting,sha} from '../lib/required-call-recording.ts';

const previous={conversation_config:{turn:{soft_timeout_config:{timeout_seconds:2,message:'One moment'}}},platform_settings:{privacy:{record_voice:false}},procedures:null,workflow:null};
const approved=sha(JSON.stringify(canonical(previous)));
const current=structuredClone(previous);
current.conversation_config.turn.soft_timeout_config.pause_after_filler=false;
assert(matchesReviewedFillerSetting(previous,approved));
assert(matchesReviewedFillerSetting(current,approved));
for(const setting of [true,null,'false',0]){
 const changed=structuredClone(current);
 changed.conversation_config.turn.soft_timeout_config.pause_after_filler=setting;
 assert.equal(matchesReviewedFillerSetting(changed,approved),false);
}
for(const modify of [
 value=>{value.conversation_config.turn.soft_timeout_config.timeout_seconds=5;},
 value=>{value.platform_settings.privacy.record_voice=true;},
 value=>{value.procedures=[];},
 value=>{value.conversation_config.turn.soft_timeout_config.new_setting=false;},
]){
 const changed=structuredClone(current);
 modify(changed);
 assert.equal(matchesReviewedFillerSetting(changed,approved),false);
}
console.log('Approved filler setting preserves the exact prior voice configuration.');
