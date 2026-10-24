import assert from 'node:assert/strict';
import {z} from 'zod';
import {newWebinar,webinarSchema,settingsSchema} from '../lib/webinar-policy.ts';
import {timerResponseSchema} from '../lib/webinar-timers.ts';
import {ownerAccountFilters} from '../lib/owner-accounts.ts';

// GHSA-mrhx-c7xc-m3w5: reject an oversized collection before inspecting elements.
let visited=0;
const item=z.string().refine(()=>{visited++;return true;});
for(const [schema,value] of [
 [z.array(item).max(2),Array(1000).fill('entry')],
 [z.set(item).max(2),new Set(['a','b','c'])],
 [z.map(item,item).max(2),new Map([['a','1'],['b','2'],['c','3']])],
]){
 const parsed=schema.safeParse(value);
 assert.equal(parsed.success,false);assert.equal(parsed.error.issues.length,1);
 assert.equal(visited,0,'Collection limits must stop work before element validation');
}

// Existing session/configuration shapes retain the same nested defaults.
const webinar=newWebinar('00000000-0000-4000-8000-000000000123');
const {audienceDisplay,purchaseNotifications,...legacy}=webinar;
const restored=webinarSchema.parse(legacy);
assert.deepEqual(restored.audienceDisplay,audienceDisplay);
assert.deepEqual(restored.purchaseNotifications,purchaseNotifications);
assert.deepEqual(webinarSchema.parse(webinar),webinar);
const legacyId='11111111-2222-3333-4444-555555555555';
assert.equal(webinarSchema.parse({...webinar,id:legacyId}).id,legacyId,'Previously accepted database UUID shapes remain valid');
assert.equal(webinarSchema.safeParse({...webinar,id:'not-an-id'}).success,false);
const settings=settingsSchema.parse({enabled:false,fromEmail:'',postalAddress:'',subjects:['one','two','three'],messages:['one','two','three']});
assert.deepEqual(settings.routing,{nightStartsAt:18,nightEndsAt:6,checkoutWindowHours:8});
assert.deepEqual(ownerAccountFilters.parse({}),{sort:'funded',q:'',page:1});

const deadline='2026-10-24T12:00:00-05:00';
assert.deepEqual(timerResponseSchema.parse({deadlines:{main:deadline},serverNow:1}),{deadlines:{main:deadline},offerDeadlines:{},serverNow:1});
assert.equal(timerResponseSchema.safeParse({deadlines:{main:'not a date'},serverNow:1}).success,false);
const night=webinarSchema.safeParse({...webinar,nightEnabled:true,nightVersion:{...webinar,videoUrl:'https://example.test/night.mp4',pitchAt:webinar.durationSeconds+1}});
assert.equal(night.success,false);
assert(night.error.issues.some(issue=>issue.path.join('.')==='nightVersion.pitchAt'),'Night validation keeps its field-specific error path');
console.log('PASS patched collection bounds, saved webinar defaults, timer maps, pagination defaults and nested recording validation.');
