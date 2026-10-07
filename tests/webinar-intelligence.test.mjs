import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as engine from '../packages/webinar-engine/src/intelligence.ts';
import {eligibleVariants,isNight} from '../packages/webinar-engine/src/index.ts';
import {newWebinar,webinarSchema,webinarOffers,settingsSchema} from '../lib/webinar-policy.ts';
import {selectRecording,createNightRecording} from '../lib/webinar-recordings.ts';
const settings={enabled:true,explorationPercent:20,minVisitors:100};
const arm=(id,revision=1,version='day',priority=0)=>({key:`${id}:${revision}:${version}`,webinarId:id,revision,version,priority});
const a=arm('a',1,'day',10),b=arm('b'),c=arm('c');
const metric=(arm,ad,buyers,n=1000,price=10000)=>({ad_key:ad,webinar_id:arm.webinarId,revision:arm.revision,recording_version:arm.version,visitors:n,mature_visitors:n,buyers,revenue_cents:buyers*price,checkouts:buyers,average_watch_seconds:500,learning_visitors:n,learning_buyers:buyers,learning_value_cents:buyers*price,learning_value_squares:buyers*price*price});
test('cold start is randomized with a stable 5% baseline and exact shares',()=>{
 const plan=engine.intelligencePlan([b,a],[],'ad:12345',settings);
 assert.equal(plan.phase,'learning');assert.equal(plan.baselineKey,a.key);assert.equal(plan.shares.reduce((n,r)=>n+r.share,0),1);
 assert.equal(plan.shares.find(r=>r.key===a.key).share,.525);
 assert.equal(engine.intelligenceChoice([b,a],plan,.02,.8,settings).mode,'holdout');
 assert.equal(engine.intelligenceChoice([b,a],plan,.5,.1,settings).arm.key,b.key);
 assert.equal(engine.intelligenceChoice([b,a],plan,.5,.9,settings).arm.key,a.key);
 const bucket=engine.intelligenceBucket('same-visitor');assert.equal(bucket,engine.intelligenceBucket('same-visitor'));
 const controls=Array.from({length:20000},(_,i)=>engine.intelligenceBucket(randomUUID())<.05).filter(Boolean).length;
 assert.ok(controls>750&&controls<1250,'Control membership is approximately 5% over random visitor IDs');
});
test('different ads can learn different winners and sparse ads use shared evidence',()=>{
 const rows=[metric(a,'ad:12345',200),metric(b,'ad:12345',20),metric(a,'ad:67890',20),metric(b,'ad:67890',200),metric(a,'*',250),metric(b,'*',50)];
 assert.equal(engine.intelligencePlan([a,b],rows,'ad:12345',settings).winnerKey,a.key);
 assert.equal(engine.intelligencePlan([a,b],rows,'ad:67890',settings).winnerKey,b.key);
 const sparse=engine.intelligencePlan([a,b],rows,'ad:99999',settings);assert.equal(sparse.source,'shared');assert.equal(sparse.winnerKey,a.key);
 const paused=engine.intelligencePlan([a,b],rows,'*',{...settings,enabled:false});assert.equal(paused.winnerKey,null);
});
test('new challengers get exploration without erasing an established comparison',()=>{
 const rows=[metric(a,'*',200),metric(b,'*',20)],plan=engine.intelligencePlan([a,b,c],rows,'*',settings);
 assert.equal(plan.winnerKey,a.key);assert.ok(plan.shares.find(r=>r.key===c.key).share>0);
 const counts={holdout:0,explore:0,winner:0};
 for(let i=0;i<100;i++)for(let j=0;j<190;j++)counts[engine.intelligenceChoice([a,b,c],plan,(i+.5)/100,(j+.5)/190,settings).mode]++;
 for(const [mode,share] of [['holdout',.05],['explore',.2],['winner',.75]])assert.ok(Math.abs(counts[mode]/19000-share)<.001,mode);
});
test('small samples, isolated purchases, equal results and obsolete revisions cannot promote a winner',()=>{
 for(const rows of [[],[metric(a,'*',9),metric(b,'*',0)],[metric(a,'*',1,1000,10000000),metric(b,'*',0)],[metric(a,'*',50),metric(b,'*',50)],[metric(a,'*',90,99),metric(b,'*',0,99)],[metric(a,'*',0),metric(b,'*',0)]])assert.equal(engine.intelligencePlan([a,b],rows,'*',settings).winnerKey,null);
 assert.equal(engine.intelligencePlan([arm('a',2),b],[metric(a,'*',300),metric(b,'*',5)],'*',settings).winnerKey,null);
 assert.equal(engine.intelligencePlan([arm('a',1,'night'),b],[metric(a,'*',300),metric(b,'*',5)],'*',settings).winnerKey,null);
});
test('ad identity accepts IDs and never treats names or unresolved macros as ads',()=>{
 for(const value of ['Creative A','{{ad.id}}','1234','x12345','12345@example.com'])assert.equal(engine.adIdentity({utm_content:value}),'direct');
 assert.equal(engine.adIdentity({utm_content:'120123456789012'}),'ad:120123456789012');assert.equal(engine.adIdentity({ad_id:'67890',utm_content:'12345'}),'ad:67890');
});
const deps={createHash,unstable_cache:fn=>fn,db:()=>{},eligibleVariants,isNight,...engine,selectRecording,webinarOffers,webinarSchema};
globalThis.__intelligenceAdapter=deps;
const source=ts.transpileModule(readFileSync(new URL('../lib/webinar-intelligence.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
const adapter=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.__intelligenceAdapter;\n'+source).toString('base64'));
const routing={nightStartsAt:18,nightEndsAt:6},day=new Date('2026-10-06T12:00:00Z'),night=new Date('2026-10-06T23:00:00Z');
// Archived experiment math uses explicitly enabled historical fixtures.
const webinar=()=>({...newWebinar(randomUUID()),intelligenceEnabled:true,status:'published',videoUrl:'https://example.test/day.mp4'});
test('candidates respect Night fallback, opt-out, deadlines, drafts and later unseen recordings',()=>{
 const one=webinar(),two=webinar(),expired={...webinar(),offerEndsAt:'2020-01-01T00:00:00Z'};
 const configs=[one,two,expired,{...webinar(),intelligenceEnabled:false},{...webinar(),status:'draft'}];
 let pool=adapter.intelligenceCandidates(configs,[],'UTC',night,routing);assert.deepEqual(pool.recordings.map(w=>w.id),[one.id,two.id]);assert.ok(pool.arms.every(a=>a.version==='day'));
 one.nightVersion={...createNightRecording(one),videoUrl:'https://example.test/night.mp4'};one.nightEnabled=true;
 pool=adapter.intelligenceCandidates(configs,[],'UTC',night,routing);assert.equal(pool.arms[0].version,'night');assert.equal(pool.arms[1].version,'day');
 const history=[{webinar_id:one.id,revision:1,progress_seconds:20,completed_at:null,updated_at:day.toISOString()}];
 assert.deepEqual(adapter.intelligenceCandidates(configs,history,'UTC',day,routing).recordings.map(w=>w.id),[two.id]);
 assert.equal(adapter.intelligenceContext(history,'UTC',night,routing),'returning:night');
 assert.equal(adapter.intelligencePoolKey([a,b]),adapter.intelligencePoolKey([b,a]));assert.notEqual(adapter.intelligencePoolKey([a,b]),adapter.intelligencePoolKey([a,c]));
});
test('historical settings remain readable without activating Meta',()=>{
 const saved=settingsSchema.parse({enabled:false,fromEmail:'',postalAddress:'',subjects:['a','b','c'],messages:['a','b','c'],optimizer:settings});assert.equal(saved.optimizer.enabled,true);assert.equal(saved.meta.enabled,false);assert.equal(saved.meta.pixelId,'');
});
test('proven losers get exactly zero traffic in every assignment mode, including the old baseline',()=>{
 const rows=[metric(a,'*',20),metric(b,'*',200)];
 const plan=engine.intelligencePlan([a,b,c],rows,'*',settings);
 assert.deepEqual(plan.stoppedKeys,[a.key]);assert.equal(plan.baselineKey,b.key);
 assert.equal(plan.shares.find(s=>s.key===a.key).share,0);
 assert.equal(plan.shares.reduce((n,s)=>n+s.share,0),1);
 for(const bucket of [0,.03,.5,.99])for(let i=0;i<1000;i++)assert.notEqual(engine.intelligenceChoice([a,b,c],plan,bucket,i/1000,settings).arm.key,a.key);
 const only=engine.intelligencePlan([a,b],rows,'*',settings);
 assert.equal(only.shares.find(s=>s.key===b.key).share,1);
 assert.equal(engine.intelligenceChoice([a,b],only,0,0,settings).arm.key,b.key);
});
test('a clearly weak third webinar stops while two close contenders keep testing',()=>{
 const plan=engine.intelligencePlan([a,b,c],[metric(a,'*',200),metric(b,'*',199),metric(c,'*',1)],'*',settings);
 assert.deepEqual(plan.stoppedKeys,[c.key]);assert.equal(plan.winnerKey,null);
 assert.equal(plan.newStops[0].winner_key,null);
 assert.equal(engine.intelligencePlan([a,b,c],[],'*',settings,plan.newStops).winnerKey,null,'Stopping third place never crowns a tied leader');
 assert.ok(plan.shares.find(s=>s.key===a.key).share>0);assert.ok(plan.shares.find(s=>s.key===b.key).share>0);
});
test('saved stops survive expired analytics and new challengers get a bounded test',()=>{
 const stops=[{ad_key:'*',arm_key:b.key,winner_key:a.key}];
 const plan=engine.intelligencePlan([a,b,c],[],'ad:12345',settings,stops);
 assert.deepEqual(plan.stoppedKeys,[b.key]);assert.equal(plan.winnerKey,a.key);
 assert.equal(plan.shares.find(s=>s.key===b.key).share,0);assert.ok(plan.shares.find(s=>s.key===c.key).share<=.2);
 const revised=arm('b',2),fresh=engine.intelligencePlan([a,revised],[],'*',settings,stops);
 assert.ok(fresh.shares.find(s=>s.key===revised.key).share>0);
 const allStopped=engine.intelligencePlan([b],[],'*',settings,stops);
 assert.equal(allStopped.shares[0].share,0);assert.equal(engine.intelligenceChoice([b],allStopped,0,0,settings),null);
});
test('ad-specific evidence can beat the shared winner without reviving that ad’s own stopped variant',()=>{
 const shared=[{ad_key:'*',arm_key:b.key,winner_key:a.key}];
 const rows=[metric(a,'ad:12345',20),metric(b,'ad:12345',200)];
 const plan=engine.intelligencePlan([a,b],rows,'ad:12345',settings,shared);
 assert.equal(plan.winnerKey,b.key);assert.deepEqual(plan.stoppedKeys,[a.key]);assert.equal(plan.newStops[0].ad_key,'ad:12345');
 const saved=engine.intelligencePlan([a,b],[],'ad:12345',settings,[{ad_key:'ad:12345',arm_key:a.key,winner_key:b.key}]);
 assert.deepEqual(saved.stoppedKeys,[a.key]);assert.equal(saved.shares.find(s=>s.key===a.key).share,0);
 const aged=engine.intelligencePlan([a,b],[],'ad:12345',settings,[...shared,...plan.newStops]);
 assert.equal(aged.source,'ad');assert.equal(aged.winnerKey,b.key);assert.deepEqual(aged.stoppedKeys,[a.key]);
});
