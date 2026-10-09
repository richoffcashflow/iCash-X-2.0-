import test from 'node:test';
import {campaignCopy} from '../lib/webinar-message-copy.ts';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {webinarReplyAddress} from '../lib/webinar-email-replies.ts';
import {readCampaignSettings,campaignSettingsSchema} from '../lib/messaging-settings.ts';
import * as policy from '../lib/webinar-policy.ts';
import {returnVisit} from '../packages/webinar-engine/src/index.ts';
import {followupCopy,followupPhase} from '../lib/webinar-followup-policy.ts';
const now=new Date('2026-10-07T16:00:00Z'),base=policy.newWebinar('00000000-0000-4000-8000-000000000123');
const history=[{id:'session',webinar_id:base.id,created_at:'2026-10-07T07:00:00Z',updated_at:'2026-10-07T09:00:00Z',completed_at:'2026-10-07T08:00:01Z',is_preview:false,superseded_at:null,max_seconds:1800,progress_seconds:1800,config:base,offer_seen_at:'2026-10-07T07:20:00Z'}];
test('completion has a full eight-hour window independent of the earlier pitch and refresh',()=>{
 const s=history[0];assert.equal(returnVisit([s],'UTC',undefined,now).kind,'checkout');
 assert.equal(returnVisit([{...s,updated_at:now.toISOString()}],'UTC',8,now).until,'2026-10-07T16:00:01.000Z');
 assert.equal(returnVisit([s],'UTC',8,new Date('2026-10-07T16:00:01Z')).kind,'advance');
 assert.equal(followupPhase(history,'UTC',8,now),'checkout');
 assert.equal(followupPhase(history,'UTC',8,new Date('2026-10-07T16:00:01Z')),'next');
 assert.equal(followupPhase([{...s,completed_at:null,offer_seen_at:null,max_seconds:90}],'UTC',8,now),'resume');
});
test('personal copy uses real progress and sanitizes headers without inventing a deadline',()=>{
 const args={name:'Casey\r\nBcc: nope',title:'The walkthrough',seconds:185,phase:'resume',step:0,brand:'Brand',host:'Host'};
 const copy=followupCopy(args);assert.equal(copy.subject,'Casey, your place is saved');assert.match(copy.body,/3:05/);assert.match(copy.body,/Hey Casey/);assert.doesNotMatch(copy.subject,/[\r\n]/);
 const custom=followupCopy({...args,smart:false,subject:'Hi {{first_name}}',message:'{{webinar}} at {{watch_time}}. {{next_step}}.'});assert.equal(custom.subject,'Hi Casey');assert.match(custom.body,/The walkthrough at 3:05/);
 assert.doesNotMatch(followupCopy({...args,phase:'checkout'}).body,/finished|expires|spots/i);
});
let settings,job,visitor,paid,authorized,transportError,responseStatus,calls,sends,campaignTargetMock;
const env={VERCEL_ENV:'production',RESEND_API_KEY:'fake-email-key',RESEND_RECEIVING_WEBHOOK_SECRET:'fake-signed-receipts',CONTIGUITY_API_KEY:'fake-text-key',CONTIGUITY_WEBHOOK_SECRET:'fake-text-receipts',CONTIGUITY_FROM:'+12125550199',ICASH_APP_ORIGIN:'https://example.test'};
function reset(channel='email'){
 settings=policy.settingsSchema.parse({enabled:true,smsEnabled:true,fromEmail:'sessions@example.test',postalAddress:'123 Example Street',subjects:['a','b','c'],messages:['a','b','c']});
 job={id:'00000000-0000-4000-8000-000000000001',visitor_id:'visitor',session_id:'session',channel,recipient:channel==='email'?'casey@example.invalid':'+12125550100',step:channel==='email'?0:1,attempts:1,payload:null};
 visitor={id:'visitor',name:'Casey Smith',timezone:'UTC'};paid=false;authorized=true;transportError=false;responseStatus=200;calls=[];sends=[];
}
const database=async(path,method,body)=>{
 calls.push({path,method,body});if(path.startsWith('icash_messaging_settings'))return [{config:campaignSettingsSchema.strip().parse(settings),revision:1}];if(path.startsWith('icash_webinar_settings'))return [{config:settings}];if(path.startsWith('icash_webinar_text_senders'))return [{phone:env.CONTIGUITY_FROM}];
 if(path==='rpc/icash_webinar_claim_followups')return (job.channel==='email'?body.p_email_ready:body.p_sms_ready)?[job]:[];
 if(path.startsWith('icash_webinar_visitors'))return [visitor];if(path.startsWith('icash_webinar_sessions'))return history;if(path.startsWith('icash_webinar_events'))return [];
 if(path==='rpc/icash_webinar_authorize_followup')return authorized?{...job,payload:job.payload??body.p_payload}:null;
 return null;
};
const transport=async(url,init)=>{sends.push({url,init});if(transportError)throw Error('Unconfirmed provider timeout');return Response.json(job.channel==='email'?{id:'provider-id'}:{data:{message_id:'provider-id'}},{status:responseStatus});};
const deps={campaignCopy,resolveCampaignTarget:async()=>campaignTargetMock,webinarReplyAddress,readCampaignSettings,db:database,...policy,webinarPaid:async()=>paid,webinarToken:()=> 'signed-unsubscribe',followupCopy,followupPhase,webinarSite:{brandName:'Brand',hostName:'Host'}};
globalThis.__followupTest=deps;
const code=ts.transpileModule(readFileSync(new URL('../lib/webinar-email.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
const {processWebinarFollowups,webinarMailTime,webinarFollowupReadiness}=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.__followupTest;\n'+code).toString('base64'));
const run=(override={})=>processWebinarFollowups({database,transport,env,clock:()=>now,...override});
test('email waits for a mailing address while explicitly opted-in texts can run',async()=>{
 reset();settings.postalAddress='';await run();assert.equal(sends.length,0);assert.equal(calls.find(c=>c.path==='rpc/icash_webinar_claim_followups').body.p_email_ready,false);
 reset('sms');settings.postalAddress='';await run();assert.equal(sends.length,1);assert.match(JSON.parse(sends[0].init.body).message,/Hey Casey/);assert.doesNotMatch(JSON.parse(sends[0].init.body).message,/Reply STOP/);assert.equal(calls.at(-1).path,'rpc/icash_webinar_finish_followup');
});
test('preview deployments never dispatch and quiet hours defer in the viewer timezone',async()=>{
 reset();await run({env:{...env,VERCEL_ENV:'preview'}});assert.equal(sends.length,0);assert.ok(!calls.some(c=>c.path.includes('claim_followups')));
 reset();await run({clock:()=>new Date('2026-10-07T02:00:00Z')});assert.equal(sends.length,0);assert.equal(calls.at(-1).body.attempts,0);assert.equal(calls.at(-1).body.due_at,'2026-10-07T09:00:00.000Z');
 assert.equal(webinarMailTime('America/Chicago',new Date('2026-11-01T06:30:00Z')).toISOString(),'2026-11-01T15:30:00.000Z');
 assert.equal(webinarFollowupReadiness(settings,{...env,ICASH_APP_ORIGIN:'http://insecure.test'}).email,false);
});
test('purchase and last-moment authorization failures suppress both channels',async()=>{
 for(const channel of ['email','sms']){reset(channel);paid=true;await run();assert.equal(sends.length,0);assert.equal(calls.at(-1).body.state,'canceled');reset(channel);authorized=false;await run();assert.equal(sends.length,0);}
});
test('email retries keep exact content and provider key, with signed one-click unsubscribe',async()=>{
 reset();await run();const first=sends[0],payload=JSON.parse(first.init.body);assert.equal(first.init.headers['Idempotency-Key'],`webinar-followup-${job.id}`);assert.match(payload.text,/\/w\//);assert.match(payload.text,/123 Example Street/);assert.ok(payload.headers['List-Unsubscribe-Post']);
 job.payload=payload;visitor.name='Different';sends=[];await run();assert.equal(sends[0].init.body,first.init.body);assert.equal(sends[0].init.headers['Idempotency-Key'],first.init.headers['Idempotency-Key']);
});
test('ambiguous SMS never retries; transient email failure retries within its durable lease',async()=>{
 reset('sms');transportError=true;await run();assert.equal(sends.length,1);assert.equal(calls.at(-1).body.state,'unknown');
 reset();responseStatus=503;await run();assert.equal(calls.at(-1).body.state,'pending');
 reset();responseStatus=422;await run();assert.equal(calls.at(-1).body.state,'failed');
});

test('webinar invitations wait instead of sending a checkout link when no webinar is available',async()=>{reset();job.campaign_id='campaign';job.destination='webinar';campaignTargetMock={phase:'checkout',path:'/webinar/checkout',title:''};await run();assert.equal(sends.length,0);assert(calls.some(c=>c.body?.state==='pending'&&c.body?.last_error==='Waiting for a published webinar'));});
