import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {readFileSync} from 'node:fs';import ts from 'typescript';import {z} from 'zod';
import {webinarLink} from '../lib/webinar-links.ts';
import * as policy from '../lib/webinar-policy.ts';import {availableOffers,selectOffer} from '../packages/webinar-engine/src/index.ts';
const id=randomUUID(),visitorId=randomUUID(),jobId=randomUUID();let calls=[],preview=false,fail=false,jobFound=true;
const config=policy.newWebinar(randomUUID());config.redirectAtEnd=true;
class WebinarError extends Error{constructor(status,message){super(message);this.status=status;}}
const deps={beginReminderVisit:async()=>{},webinarLink,...policy,z,availableOffers,selectOffer,sessionWebinarOffers:async()=>policy.webinarOffers(config),WebinarError,webinarSite:{viewerPath:'/webinar'},webinarHeaders:{'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'},webinarToken:(id,purpose)=>`${purpose}-${id}`,webinarLimit:async()=>{},webinarOrigin:()=>{},webinarBody:req=>req.json(),webinarSession:async()=>({v:{id:visitorId},s:{id,config,is_preview:preview}}),webinarError:e=>Response.json({error:e.message},{status:e.status||503}),db:async(path,method,body)=>{calls.push({path,method,body});if(fail)throw Error('database unavailable');if(path.startsWith('icash_webinar_outbox?'))return jobFound?[{visitor_id:visitorId,session_id:id}]:[];if(path.startsWith('icash_webinar_sessions?'))return [{webinar_id:config.id}];if(path.startsWith('icash_webinars?'))return [{public_code:129339}];return null;}};
async function load(path,key){globalThis[key]=deps;const source=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');return import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.'+key+';\n'+source).toString('base64'));}
const event=await load('../app/api/webinar/event/route.ts','__followEvent'),contact=await load('../app/api/webinar/contact/route.ts','__followContact'),link=await load('../app/w/[token]/route.ts','__followLink');
const post=(route,body)=>route.POST(new Request('https://example.test/api/webinar',{method:'POST',body:JSON.stringify(body)}));
let response=await post(event,{sessionId:id,seconds:config.durationSeconds,kind:'completed'});assert.equal((await response.json()).redirect,`/webinar/checkout?webinar_session=${id}`);assert.equal(calls.at(-1).path,'rpc/icash_webinar_record');
fail=true;response=await post(event,{sessionId:id,seconds:config.durationSeconds,kind:'completed'});assert.equal(response.status,503);assert.equal((await response.json()).redirect,undefined);fail=false;
preview=true;response=await post(event,{sessionId:id,seconds:config.durationSeconds,kind:'completed'});assert.equal((await response.json()).redirect,undefined);preview=false;
response=await post(event,{sessionId:id,seconds:10,kind:'completed'});assert.equal((await response.json()).redirect,undefined);
config.parentWebinarId=randomUUID();config.redirectAtEnd=false;
response=await post(event,{sessionId:id,seconds:config.durationSeconds,kind:'completed'});assert.equal((await response.json()).redirect,'/webinar/upgrade','VIP completion goes to the upgrade even without a base checkout redirect');
preview=true;response=await post(event,{sessionId:id,seconds:config.durationSeconds,kind:'completed'});assert.equal((await response.json()).redirect,undefined);preview=false;
response=await post(event,{sessionId:id,seconds:10,kind:'completed'});assert.equal((await response.json()).redirect,undefined);
config.parentWebinarId=null;config.redirectAtEnd=true;
const body={sessionId:id,name:'Casey',email:'casey@example.invalid',phone:'2125550100',consent:true,version:policy.webinarConsentVersion};
calls=[];
for(const patch of [{},{smsConsent:true,smsVersion:policy.webinarSmsConsentVersion},{version:'webinar-email-campaign-2026-10-08'},{version:'webinar-email-ongoing-2026-10-09'}]){
 assert.equal((await post(contact,{...body,...patch})).status,410,'Old forms cannot enroll reminder contacts');
}
assert.equal(calls.length,0,'Retired opt-ins never write contacts or enqueue work');
assert.equal((await post(contact,{sessionId:id,name:'Casey',onlyName:true})).status,200);
assert.deepEqual(calls.at(-1),{path:'icash_webinar_visitors?id=eq.'+visitorId,method:'PATCH',body:{name:'Casey'}},'Name-only chat stays available');
const get=token=>link.GET(new Request('https://example.test/w/'+token),{params:Promise.resolve({token})});
calls=[];response=await get(jobId);assert.equal(response.status,302);assert.equal(new URL(response.headers.get('Location')).pathname,'/live/129339');assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');assert.equal(new URL(response.headers.get('Location')).searchParams.get('r'),'resume-'+visitorId);assert.ok(calls.every(c=>!c.method),'Opening a link does not enroll or send anything');assert.ok(calls[0].path.includes('sent_at.gte.'));
jobFound=false;response=await get(jobId);assert.equal(response.headers.get('Location'),'https://example.test/webinar');calls=[];await get('malformed');assert.equal(calls.length,0);fail=true;assert.equal((await get(jobId)).status,503);
console.log('Follow-up routes passed: durable completion redirect, preview isolation, removed reminder enrollment, name-only chat, private resume links and safe expiration.');
