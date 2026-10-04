import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {freezeTimeline,optimizedWebinar} from '../packages/webinar-engine/src/index.ts';
test('two companies reuse the engine with independent content and assistant names',()=>{
 const notes=[{id:'welcome',at:8,name:'Host',text:'Welcome',kind:'host',variations:['Welcome to this session','Ready to get started?']}];
 const one=freezeTimeline(notes,'one-session',true,'Company One assistant');
 const two=freezeTimeline(notes,'two-session',true,'Company Two assistant');
 assert.equal(one[0].name,'Company One assistant');assert.equal(two[0].name,'Company Two assistant');assert.equal(notes[0].name,'Host');
 const config={id:'company-two-video',revision:1,status:'published',audience:'all',priority:0,videoUrl:'https://company-two.example/video.mp4'};
 assert.equal(optimizedWebinar([config],[],'UTC',[],{enabled:true,explorationPercent:20,minVisitors:100},.5).id,config.id);
});
test('the portable source has no application, provider, credential or runtime package imports',()=>{
 const source=readFileSync(new URL('../packages/webinar-engine/src/index.ts',import.meta.url),'utf8');
 assert.doesNotMatch(source,/^import\s/m);assert.doesNotMatch(source,/process\.env|icash_accounts|next\/|supabase|api\.openai|stripe_payment/i);
 const pkg=JSON.parse(readFileSync(new URL('../packages/webinar-engine/package.json',import.meta.url),'utf8'));assert.equal(pkg.private,true);assert.equal(Object.keys(pkg.dependencies??{}).length,0);
});
