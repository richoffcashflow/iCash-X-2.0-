import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import ts from 'typescript';import {z} from 'zod';
import {campaignTarget,campaignCopy} from '../lib/webinar-campaign.ts';
import {newWebinar,settingsSchema} from '../lib/webinar-policy.ts';
const now=new Date('2026-10-08T23:00:00Z'),settings=settingsSchema.parse({enabled:true,fromEmail:'sessions@example.test',postalAddress:'Test address',subjects:['a','b','c'],messages:['a','b','c']}),make=(code)=>({...newWebinar(randomUUID()),publicCode:String(code),status:'published',videoUrl:'https://example.test/day.mp4'});
const a=make(111111),b=make(222222),c=make(333333);
const session={id:randomUUID(),webinar_id:a.id,is_preview:false,config:a,created_at:'2026-10-08T20:00:00Z',completed_at:'2026-10-08T21:00:00Z',watched_seconds:a.durationSeconds,progress_seconds:a.durationSeconds};
const target=(mode,history=[session],pool=[a,b,c],stats=[])=>campaignTarget(mode,a.id,history,pool,stats,'UTC',settings.routing,now);
test('campaign links preserve checkout window, resume, unseen webinar choice and Day/Night stats',()=>{
 assert.equal(target('smart').path,'/webinar/checkout');assert.equal(target('checkout').sessionId,session.id);
 assert.equal(target('smart',[{...session,completed_at:null}]).path,'/live/111111');
 const night={...b,nightEnabled:true,nightVersion:{...b,videoUrl:'https://example.test/night.mp4'}};
 const stats=[{webinarId:b.id,version:'night',viewers:30,cohortBuyers:15},{webinarId:c.id,version:'day',viewers:30,cohortBuyers:10}];
 assert.equal(target('webinar',[session],[a,night,c],stats).path,'/live/222222');
 assert.equal(target('webinar',[session,{...session,webinar_id:b.id,config:b}], [a,b,c],stats).path,'/live/333333');
 assert.equal(target('webinar',[session],[a]).phase,'checkout');
 assert.equal(target('webinar',[session],[a,{...b,parentWebinarId:a.id}]).phase,'checkout','VIP never used to acquire prospects');
});
test('copy is personalized, portable, and based on the current destination',()=>{
 const x=campaignCopy({name:'Alex\r\nHeader: value',brand:'Company Two',host:'Jamie',phase:'checkout',title:'Session',step:100});
 assert.match(x.body,/Hey Alex,/);assert.match(x.body,/Get Company Two access/);assert.doesNotMatch(x.subject,/[\r\n]/);assert.doesNotMatch(x.body,/spots|expires|guaranteed/i);
});
const deps={z,db:()=>{throw Error('No real database');}};globalThis.__campaignSenders=deps;
const source=ts.transpileModule(readFileSync(new URL('../lib/webinar-campaign-senders.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
const {campaignTextNumbers,syncCampaignTextNumbers}=await import('data:text/javascript;base64,'+Buffer.from('const {z,db}=globalThis.__campaignSenders;\n'+source).toString('base64'));
test('number refresh verifies active SMS leases and never reactivates paused conversations',async()=>{
 const n=(phone,status='active',channels=['sms'])=>({number:{e164:phone},lease_status:status,capabilities:{channels}});
 const lease={data:{numbers:[n('+12125550100'),n('+12125550101'),n('+12125550102','paused'),n('+12125550103','active',['imessage'])]}};
 assert.deepEqual(campaignTextNumbers(lease),['+12125550100','+12125550101']);
 const calls=[],db=async(path,method,body)=>{calls.push({path,method,body});return [{phone:'+12125550100',enabled:false},{phone:'+12125550109',enabled:true}];};
 await syncCampaignTextNumbers(db,async()=>Response.json(lease),{CONTIGUITY_API_KEY:'mock'});
 assert(calls.some(c=>c.method==='POST'&&c.body.phone==='+12125550101'));
 assert(calls.some(c=>c.body?.enabled===false&&c.path.includes('12125550109')));
 assert(!calls.some(c=>c.body?.enabled===true));
 calls.length=0;await assert.rejects(syncCampaignTextNumbers(db,async()=>Response.json({}, {status:503}),{CONTIGUITY_API_KEY:'mock'}));assert.equal(calls.length,0);
});
