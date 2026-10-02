import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadService} from './helpers/simulated-journey-services.mjs';
let stored=null,reads=0,writes=0,mode='normal';
const db=async(path,method,body)=>{if(!method){reads++;return stored?[{review_token:stored}]:[];}assert.equal(method,'POST');assert.equal(path,'icash_owner_audio_phone_pin');assert.equal(body.id,1);writes++;if(mode==='race'){stored='different';throw Error('conflict');}if(mode==='uncertain'){stored=body.review_token;throw Error('timeout');}if(mode==='failed')throw Error('failed');stored=body.review_token;return[];};
const s=await loadService('lib/owner-audio-phone-pin-store.ts',{db});
assert.equal(await s.savedAudioPhonePinReview(),null);await s.saveAudioPhonePinReview('signed-review');assert.equal(stored,'signed-review');assert.equal(writes,1);await assert.rejects(()=>s.saveAudioPhonePinReview('signed-review'));assert.equal(writes,1);await assert.rejects(()=>s.saveAudioPhonePinReview('different'));assert.equal(writes,1);
for(const m of ['race','failed']){stored=null;mode=m;await assert.rejects(()=>s.saveAudioPhonePinReview('signed-review'));}
stored=null;mode='uncertain';await assert.rejects(()=>s.saveAudioPhonePinReview('signed-review'));assert.equal(stored,'signed-review');await assert.rejects(()=>s.saveAudioPhonePinReview('signed-review'));
const sql=readFileSync('config/owner-audio-phone-pin.sql','utf8');assert.match(sql,/enable row level security/);assert.match(sql,/grant select,insert.*to service_role/);assert.match(sql,/revoke all.*public,anon,authenticated,service_role/);assert(!/grant.*(?:update|delete)/i.test(sql));assert.match(sql,/check \(id=1\)/);
console.log('Durable phone review store: immutable first review, readback, racing insert and uncertain response checks passed');
