import test from 'node:test';
import assert from 'node:assert/strict';
import {newWebinar,webinarSchema} from '../lib/webinar-policy.ts';
import {simulatedAudience} from '../packages/webinar-engine/src/index.ts';
import {activityMessage,activityAge,recentActivity,approximateRegion,activitySchema} from '../lib/webinar-activity.ts';
const id='00000000-0000-4000-8000-000000000001',w=()=>newWebinar(id);
test('old webinars get actual audience and offer-timed notifications without invalidating the snapshot',()=>{
 const {audienceDisplay,purchaseNotifications,...old}=w();const parsed=webinarSchema.parse(old);
 assert.equal(parsed.audienceDisplay.mode,'actual');assert.equal(parsed.purchaseNotifications.startAt,null);assert.equal(parsed.purchaseNotifications.enabled,true);
 assert.equal(webinarSchema.safeParse({...w(),audienceDisplay:{...audienceDisplay,minimum:100,maximum:50}}).success,false);
 assert.equal(webinarSchema.safeParse({...w(),purchaseNotifications:{...purchaseNotifications,startAt:1801}}).success,false);
 assert.equal(webinarSchema.safeParse({...w(),purchaseNotifications:{...purchaseNotifications,intervalSeconds:1}}).success,false);
 assert.equal(webinarSchema.safeParse({...w(),audienceDisplay:{...audienceDisplay,fixedCount:2.5}}).success,false);
});
test('simulated counts are bounded and stable across resume, while actual counts are never simulated',()=>{
 const config={mode:'simulated',fixedCount:125,minimum:80,maximum:160};
 const numbers=Array.from({length:301},(_,n)=>simulatedAudience(config,id,n*10));
 assert.ok(numbers.every(n=>Number.isInteger(n)&&n>=80&&n<=160));assert.ok(new Set(numbers).size>10);
 assert.equal(simulatedAudience(config,id,145),simulatedAudience(config,id,149));
 assert.equal(simulatedAudience(config,id,300),numbers[30]);
 assert.notDeepEqual(numbers,Array.from({length:301},(_,n)=>simulatedAudience(config,'another session',n*10)));
 assert.equal(simulatedAudience({...config,mode:'fixed'},id,300),125);
 assert.equal(simulatedAudience({...config,mode:'actual'},id,300),null);
 assert.equal(simulatedAudience({...config,minimum:40,maximum:40},id,300),40);
});
test('locations use coarse validated regions with no invented fallback',()=>{
 assert.equal(approximateRegion('US','TX'),'Texas');assert.equal(approximateRegion('US','ZZ'),'the United States');
 assert.equal(approximateRegion('US','__proto__'),'the United States');assert.equal(approximateRegion('CA','ON'),'Canada');
 for(const country of [null,'ZZ','AA','<script>','123',''])assert.equal(approximateRegion(country,'TX'),null);
});
test('purchase wording distinguishes credits, daily budgets and software access',()=>{
 const event={id:'a'.repeat(32),kind:'funding',amountCents:1000,occurredAt:'2026-10-04T12:00:00Z',region:'Texas'};
 assert.equal(activityMessage(event),'A viewer in Texas added $10 to their bot');
 assert.equal(activityMessage({...event,kind:'daily'}),'A viewer in Texas started a $10/day bot budget');
 assert.equal(activityMessage({...event,kind:'membership',region:null}),'A viewer got software access');
 assert.equal(activityMessage({...event,amountCents:1050,region:null}),'A viewer added $10.50 to their bot');
 assert.equal(activityAge(event.occurredAt,Date.parse('2026-10-04T12:03:30Z')),'3 min ago');
 assert.equal(activityAge(event.occurredAt,Date.parse('2026-10-04T12:00:30Z')),'Less than a minute ago');
 assert.deepEqual(activitySchema.parse({...event,payment_id:'private',email:'private@example.test'}),event);
});
test('activity expires instead of becoming a recycled just-now event',()=>{
 const now=Date.parse('2026-10-04T12:20:00Z'),base={id:'a'.repeat(32),kind:'daily',amountCents:1000,region:null};
 const events=[-16,-15,-10,-1,1].map(minutes=>({...base,occurredAt:new Date(now+minutes*60000).toISOString()}));
 assert.deepEqual(recentActivity(events,now).map(e=>e.occurredAt),['2026-10-04T12:19:00.000Z','2026-10-04T12:10:00.000Z']);
});
