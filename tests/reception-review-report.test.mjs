import test from 'node:test';
import assert from 'node:assert/strict';
import {receptionReviewReport} from '../scripts/reception-review-report.mjs';

test('private review retains settings while removing credentials, prompt and placeholder contents',()=>{
 const secret='fixture-secret-value',raw={agent_id:'agent_fixture',conversation_config:{tts:{voice_id:'voice_fixture',speed:1},agent:{prompt:{prompt:'private prompt',llm:'gpt-4.1-mini',tools:[{api_schema:{request_headers:{Authorization:secret}},description:'prefix '+secret}]},dynamic_variables:{dynamic_variable_placeholders:{customer:'private person'}}}},platform_settings:{privacy:{record_voice:false},auth:{enable_auth:true},[secret]:{password:secret}}};
 const before=structuredClone(raw),report=receptionReviewReport(raw,[secret]),json=JSON.stringify(report);
 for(const privateText of [secret,'private prompt','private person'])assert(!json.includes(privateText));
 assert.equal(report.conversation_config.tts.voice_id,'voice_fixture');
 assert.equal(report.conversation_config.agent.prompt.llm,'gpt-4.1-mini');
 assert.equal(report.platform_settings.privacy.record_voice,false);
 assert.deepEqual(raw,before);
 assert.equal('safe' in report,false);
});
