import test from 'node:test';
import assert from 'node:assert/strict';
import {saveActiveIncomingReviewReport} from '../scripts/check-telephony-connection.mjs';
import {canonical,sha} from '../lib/required-call-recording.ts';

function fixture(){
 const env={VERCEL:'1',VERCEL_ENV:'production',SUPABASE_URL:'https://db.invalid',SUPABASE_SECRET_KEY:'fixture-database-secret',ELEVENLABS_API_KEY:'fixture-provider-secret',TWILIO_AUTH_TOKEN:'fixture-carrier-secret'};
 const config={id:'fixture-config',config_hash:'a'.repeat(64),agent_id:'agent_fixture',branch_id:'agtbrch_fixture',reviewed_version_id:'agtvrsn_fixture'};
 const agent={main_branch_id:'agtbrch_main',agent_id:config.agent_id,branch_id:config.branch_id,version_id:config.reviewed_version_id,conversation_config:{agent:{prompt:{prompt:'private prompt',tools:[{api_schema:{request_headers:{Authorization:env.ELEVENLABS_API_KEY}},description:env.TWILIO_AUTH_TOKEN}]},dynamic_variables:{dynamic_variable_placeholders:{seller:'private seller'}}}},platform_settings:{privacy:{record_voice:false}},workflow:null,procedures:null};
 const observedHash=sha(JSON.stringify(canonical(agent)));
 const result={checkedAt:'2026-10-19T23:00:00Z',activeIncoming:{status:'checked',hashMatch:'none',observedHash,approvedHash:config.config_hash,configId:config.id,branchId:config.branch_id,versionId:config.reviewed_version_id,providerChecksPass:false,checks:{exactPrompt:true,approvedHashMatches:false}}};
 const requests=[],fetcher=async(url,init)=>{requests.push({url,init});return new Response(null,{status:201});};
 return {env,config,agent,result,requests,fetcher};
}

test('active incoming mismatch is immutable, redacted private evidence, never an approval',async()=>{
 const f=fixture(),before=structuredClone({agent:f.agent,config:f.config,result:f.result});
 assert.equal(await saveActiveIncomingReviewReport(f.result,f.agent,f.config,f.env,f.fetcher),true);
 assert.equal(f.requests.length,1);
 const {url,init}=f.requests[0];
 assert.equal(url,'https://db.invalid/rest/v1/icash_integration_checks?on_conflict=provider');
 assert.equal(init.method,'POST');assert.equal(init.headers.Prefer,'resolution=ignore-duplicates');assert.equal(init.redirect,'error');
 const row=JSON.parse(init.body),r=row.result;
 assert.equal(row.provider,'active_incoming_config_review_'+f.result.activeIncoming.observedHash.slice(0,12));
 assert.equal(r.sourceConfigHash,f.config.config_hash);assert.equal(r.status,'needs_review');
 assert.equal(r.approvalChanged,false);assert.equal(r.providerWrites,false);assert.equal(r.calls,false);
 assert.equal(r.checks.approvedHashMatches,false);assert.equal(r.configuration.platform_settings.privacy.record_voice,false);
 for(const hidden of [f.env.SUPABASE_SECRET_KEY,f.env.ELEVENLABS_API_KEY,f.env.TWILIO_AUTH_TOKEN,'private prompt','private seller'])assert(!init.body.includes(hidden));
 assert.deepEqual({agent:f.agent,config:f.config,result:f.result},before);
});

test('preview, unavailable, compatible and mismatched-source reports cannot write shared evidence',async()=>{
 const changes=[
  f=>{f.env.VERCEL_ENV='preview';},f=>{f.env.VERCEL_TARGET_ENV='preview';},
  f=>{delete f.env.SUPABASE_SECRET_KEY;},f=>{f.result.activeIncoming.status='unavailable';},
  f=>{f.result.activeIncoming.hashMatch='exact';},f=>{f.result.activeIncoming.hashMatch='equivalent_empty_defaults';},
  f=>{f.result.activeIncoming.observedHash='invalid';},f=>{f.result.activeIncoming.observedHash='b'.repeat(64);},
  f=>{f.config.config_hash='b'.repeat(64);},f=>{f.config.id='different';},
  f=>{f.config.agent_id='agent_other';},f=>{f.config.branch_id='agtbrch_other';},f=>{f.config.reviewed_version_id='agtvrsn_other';},
  f=>{f.agent.version_id='agtvrsn_changed';},f=>{f.agent.platform_settings.privacy.record_voice=true;},
 ];
 for(const change of changes){const f=fixture();change(f);assert.equal(await saveActiveIncomingReviewReport(f.result,f.agent,f.config,f.env,f.fetcher),false);assert.equal(f.requests.length,0);}
});
