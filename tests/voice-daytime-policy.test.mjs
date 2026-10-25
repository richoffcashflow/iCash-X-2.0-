import assert from 'node:assert/strict';
import {contactEligibility,nextContactWindow} from '../lib/live-dispatch-policy.ts';
import {readVoiceOutreachContext,outreachHoursPolicyVersion} from '../lib/outreach-hours.ts';
const context=(timezone='America/New_York',activeConversation=false)=>({timezone,startHour:9,endHour:21,activeConversation,policyVersion:outreachHoursPolicyVersion});
const permission=now=>({phone:'+12145550123',timezone:'Etc/UTC',local_start_hour:19,local_end_hour:20,permission_until:new Date(now+86400000).toISOString(),dnc_checked_at:new Date(now-1000).toISOString(),dnc_clear:true,revoked_at:null});
const check=(when,zone='America/New_York',active=false,updates={})=>{const now=Date.parse(when);return contactEligibility({...permission(now),...updates},now,context(zone,active));};
for(const [stamp,ready] of [['2026-07-01T12:59:59Z',false],['2026-07-01T13:00:00Z',true],['2026-07-02T00:59:59Z',true],['2026-07-02T01:00:00Z',false]])assert.equal(check(stamp).ready,ready,stamp);
// Both DST changes and a fractional-hour recipient zone use real instants.
for(const [stamp,ready] of [['2026-03-07T13:59:59Z',false],['2026-03-07T14:00:00Z',true],['2026-03-08T12:59:59Z',false],['2026-03-08T13:00:00Z',true],['2026-11-01T13:59:59Z',false],['2026-11-01T14:00:00Z',true]])assert.equal(check(stamp).ready,ready,stamp);
assert.equal(check('2026-07-01T11:29:59Z','America/St_Johns').ready,false);
assert.equal(check('2026-07-01T11:30:00Z','America/St_Johns').ready,true);
assert.equal(check('2026-07-02T23:30:00Z','America/St_Johns').ready,false);
// The RPC supplies Central Time only when source/recipient timezone is unknown.
assert.equal(check('2026-07-01T13:00:00Z','America/Chicago').ready,false);
assert.equal(check('2026-07-01T14:00:00Z','America/Chicago').ready,true);
assert.equal(check('2026-07-01T13:00:00Z','America/New_York').ready,true);
assert.equal(check('2026-07-01T19:00:00Z','Pacific/Honolulu').ready,true);
assert.equal(check('2026-07-02T06:59:59Z','Pacific/Honolulu').ready,true);
assert.equal(check('2026-07-02T07:00:00Z','Pacific/Honolulu').ready,false);

const overnight=Date.parse('2026-11-01T03:30:00Z');
const original=permission(overnight),unchanged=structuredClone(original);
assert.equal(nextContactWindow(original,overnight,context('America/Chicago')),'2026-11-01T15:00:00.000Z');
assert.deepEqual(original,unchanged,'Current timing policy never rewrites historical routing metadata');
assert.equal(nextContactWindow({...original,permission_until:'2026-11-01T14:59:59Z'},overnight,context('America/Chicago')),null,'Do not schedule past permission expiry');
assert.equal(nextContactWindow(original,overnight),null,'Missing server context cannot schedule outreach');

// New consented forms, existing conversations and callbacks all honor the
// outbound calling window, including an older server's active flag.
for(const [when,ready] of [['2026-10-06T13:59:59Z',false],['2026-10-06T14:00:00Z',true],['2026-10-07T01:59:59Z',true],['2026-10-07T02:00:00Z',false]]){
 const consent={sellerConsentVerified:true,sellerCallbackVerified:true,dnc_checked_at:null,dnc_clear:false};
 assert.equal(check(when,'America/Chicago',false,consent).ready,ready,'A first consented inbound contact is still timed');
 assert.equal(check(when,'America/Chicago',true,consent).ready,ready,'Prior conversation cannot bypass the outbound call window');
 assert.equal(check(when,'America/Chicago',true,{...consent,revoked_at:when}).ready,false);
 assert.equal(check(when,'America/Chicago',true,{...consent,sellerConsentVerified:false}).ready,false);
}
for(const value of [null,{},context('invalid'),{...context(),activeConversation:'true'},{...context(),endHour:24},{...context(),policyVersion:'old'}])assert.equal(readVoiceOutreachContext(value),null);
assert.deepEqual(readVoiceOutreachContext(context('America/Chicago')),context('America/Chicago'));
console.log('Voice outreach: strict server-derived 9 AM–9 PM, recipient/Central clocks, DST, no conversation bypass, preserved evidence and fail-closed malformed context. No provider traffic.');
