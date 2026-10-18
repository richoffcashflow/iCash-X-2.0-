import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
import {z} from 'zod';
import {signWebinarToken,readWebinarToken} from '../lib/webinar-token.ts';
import * as policy from '../lib/webinar-reminder-policy.ts';
const key='fixture-reminder-secret',visitor=randomUUID(),job=randomUUID(),session=randomUUID();
const cookie=new Map(),writes=[];let fail=false,allowed=true,visitSaved=true,owner=true,queryLog=[];
const deps={...policy,z,randomUUID,signWebinarToken,readWebinarToken,webinarKey:()=>key,webinarToken:(id,purpose,seconds)=>signWebinarToken(id,purpose,seconds,key),
 cookies:async()=>({get:k=>cookie.has(k)?{value:cookie.get(k)}:undefined,set:(k,v,o)=>{cookie.set(k,v);writes.push({k,v,o});}}),
 webinarVisitor:async()=>({id:visitor}),webinarOrigin:()=>{if(!allowed)throw Error('origin');},webinarLimit:async()=>{},webinarBody:r=>r.json(),webinarHeaders:{'Cache-Control':'private, no-store'},webinarError:()=>Response.json({error:'Rejected'},{status:400}),webinarOwner:async()=>{if(!owner)throw Error('owner');},readCampaignSettings:async()=>({settings:{},fromEmail:'fixture@example.invalid',postalAddress:'Fixture'}),webinarFollowupReadiness:()=>({email:true,sms:true}),
 db:async(path,method,body,signal)=>{queryLog.push({path,method,body});if(fail)throw Error('offline');if(path.includes('open_reminder'))return visitSaved;if(path.includes('confirm_reminder'))return true;if(path.includes('outbox?'))return [{id:job}];if(path.includes('reminder_results'))return {trackingSince:'2026-10-18T00:00:00Z',overall:{purchases:0}};return [];}
};
async function load(path,scope,extra={}){const d={...deps,...extra};globalThis[scope]=d;const source=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .*;\s*$/gm,'');return import('data:text/javascript;base64,'+Buffer.from(`const {${Object.keys(d).join(',')}}=globalThis.${scope};\n`+source).toString('base64'));}
const original=process.env.VERCEL_ENV;process.env.VERCEL_ENV='production';
const req=(headers={},method='GET')=>new Request('https://www.geticashx.com/w/'+job,{method,headers:{'user-agent':'Mozilla/5.0 Safari/605.1',...headers}});
try{
 const helper=await load('../lib/webinar-reminder-server.ts','__reminderServer');
 for(const headers of [{'user-agent':'facebookexternalhit/1.1'},{'user-agent':'Slackbot-LinkExpanding'},{'user-agent':'Mozilla/5.0 Proofpoint'},{purpose:'prefetch'},{'sec-purpose':'prefetch;prerender'},{'sec-gpc':'1'}])await helper.beginReminderVisit(req(headers),job,visitor);
 await helper.beginReminderVisit(req({},'HEAD'),job,visitor);assert.equal(queryLog.length,0,'Scanners/prefetch/HEAD/opt-outs create no analytics');
 process.env.VERCEL_ENV='preview';await helper.beginReminderVisit(req(),job,visitor);assert.equal(queryLog.length,0);process.env.VERCEL_ENV='production';
 await helper.beginReminderVisit(req(),job,visitor);assert.equal(queryLog.length,1);assert.equal(writes.find(w=>w.k===policy.reminderCookie).o.httpOnly,true);assert.equal(writes.find(w=>w.k===policy.reminderCookie).o.sameSite,'lax');
 const visit=await helper.reminderVisitId(req());assert.equal(visit,queryLog[0].body.p_visit);assert.equal(readWebinarToken(cookie.get(policy.reminderCookie),'visitor',key),null,'Attribution cannot be used as a visitor/login token');
 assert.equal(readWebinarToken(cookie.get('icash_webinar'),'visitor',key),visitor,'A new device restores only the webinar identity');
 queryLog=[];await helper.bindReminderCheckout(req(),'cs_live_fixture','live');assert.deepEqual(queryLog[0].body,{p_visit:visit,p_visitor:visitor,p_checkout:'cs_live_fixture'});
 queryLog=[];await helper.bindReminderCheckout(req(),'cs_test_fixture','test');await helper.bindReminderCheckout(req({'sec-gpc':'1'}),'cs_live_fixture','live');assert.equal(queryLog.length,0);
 cookie.set(policy.reminderCookie,signWebinarToken(visit,'reminder',-1,key));assert.equal(await helper.reminderVisitId(req()),null);
 cookie.set(policy.reminderCookie,'forged');assert.equal(await helper.reminderVisitId(req()),null);
 cookie.set(policy.reminderCookie,signWebinarToken(visit,'reminder',600,key));fail=true;await assert.doesNotReject(()=>helper.beginReminderVisit(req(),job,visitor));await assert.doesNotReject(()=>helper.bindReminderCheckout(req(),'cs_live_fixture','live'));fail=false;
 const route=await load('../app/api/webinar/reminder-visit/route.ts','__reminderVisitRoute',{reminderVisitId:helper.reminderVisitId});
 const post=body=>route.POST(new Request('https://www.geticashx.com/api/webinar/reminder-visit',{method:'POST',headers:{origin:'https://www.geticashx.com'},body:JSON.stringify(body)}));
 queryLog=[];assert.equal((await post({action:'visit'})).status,200);assert.deepEqual(queryLog.at(-1).body,{p_visit:visit,p_visitor:visitor,p_action:'visit',p_session:null});
 assert.equal((await post({action:'watch',sessionId:session})).status,200);assert.equal(queryLog.at(-1).body.p_session,session);
 for(const body of [{action:'purchase',amount:5000},{action:'watch',sessionId:'bad'},{action:'visit',visitorId:randomUUID()},{action:'visit',jobId:job}])assert.equal((await post(body)).status,400);
 allowed=false;assert.equal((await post({action:'visit'})).status,400);allowed=true;
 cookie.delete(policy.reminderCookie);queryLog=[];assert.equal((await post({action:'visit'})).status,204);assert.equal(queryLog.length,0);
 const admin=await load('../app/api/messaging/admin/sequence/route.ts','__reminderAdminRoute');
 owner=false;queryLog=[];assert.equal((await admin.GET()).status,400);assert.equal(queryLog.length,0,'Owner authorization precedes every data read');
 owner=true;let data=await(await admin.GET()).json();assert.ok(data.results);assert.deepEqual(queryLog.find(c=>c.path==='rpc/icash_webinar_reminder_results').body,{p_jobs:[job]});
 console.log('PASS reminder routes: signed browser evidence, preview/scanner/HEAD filtering, independent safe checkout attribution, malformed/cross-origin inputs and private admin totals.');
}finally{if(original===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=original;}
