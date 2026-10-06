import assert from 'node:assert/strict';
import {contactEligibility} from '../lib/live-dispatch-policy.ts';
const check=(when,zone='America/New_York',start=9,end=20)=>{const now=Date.parse(when);return contactEligibility({phone:'+12145550123',timezone:zone,local_start_hour:start,local_end_hour:end,permission_until:new Date(now+86400000).toISOString(),dnc_checked_at:new Date(now-1000).toISOString(),dnc_clear:true,revoked_at:null},now);};
for(const [stamp,ready] of [['2026-07-01T12:59:59Z',false],['2026-07-01T13:00:00Z',true],['2026-07-01T21:59:59Z',true],['2026-07-01T22:00:00Z',false]])assert.equal(check(stamp).ready,ready,stamp);
// Current time-zone database handles standard time and both DST transitions.
for(const [stamp,ready] of [['2026-03-07T13:59:59Z',false],['2026-03-07T14:00:00Z',true],['2026-03-08T12:59:59Z',false],['2026-03-08T13:00:00Z',true],['2026-11-01T13:59:59Z',false],['2026-11-01T14:00:00Z',true]])assert.equal(check(stamp).ready,ready,stamp);
assert.equal(check('2026-07-01T13:00:00Z','America/New_York',10,17).ready,false,'Narrower customer window remains');
assert.equal(check('2026-07-01T21:00:00Z','America/New_York',10,17).ready,false);
assert.equal(check('2026-07-01T19:00:00Z','Pacific/Honolulu',9,10).ready,true);
assert.equal(check('2026-07-01T20:00:00Z','Pacific/Honolulu',9,10).ready,false);
const zones=['Pacific/Honolulu','America/Adak','America/Anchorage','America/Los_Angeles','America/Phoenix','America/Denver','America/Chicago','America/New_York','America/Puerto_Rico','America/Halifax','America/St_Johns'];
for(const day of ['2026-01-15','2026-03-08','2026-07-15','2026-11-01'])for(const zone of zones)for(const time of ['19:00:00','19:59:59']){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date(`${day}T${time}Z`));const hour=Number(parts.find(p=>p.type==='hour').value);assert(hour>=9&&hour<18,`${day} ${zone} ${time}`);
}
console.log('Voice daytime: legacy/new 09:00 inclusive–18:00 exclusive, stricter windows, DST boundaries and conservative supported-region UTC19–20 policy. No claim of verified recipient location or learned best times.');

for(const [when,ready] of [['2026-10-06T23:59:00Z',true],['2026-10-07T01:00:00Z',false]]){
 const now=Date.parse(when);const inbound={phone:'+12145550123',timezone:'America/Chicago',local_start_hour:9,local_end_hour:20,permission_until:new Date(now+86400000).toISOString(),dnc_checked_at:null,dnc_clear:false,revoked_at:null,sellerConsentVerified:true};
 assert.equal(contactEligibility(inbound,now).ready,ready,'Verified request uses configured 9–20 window');
 assert.equal(contactEligibility({...inbound,sellerConsentVerified:false},now).ready,false);
}
