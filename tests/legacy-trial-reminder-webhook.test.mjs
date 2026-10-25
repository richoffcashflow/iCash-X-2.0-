import assert from 'node:assert/strict';
import {loadService} from './helpers/simulated-journey-services.mjs';
process.env.STRIPE_WEBHOOK_SECRET='whsec_fixture';
let calls=[],fail=false,mode='live';
const event={type:'customer.subscription.trial_will_end',livemode:true,data:{object:{id:'sub_fixture',customer:{email:'untrusted@example.invalid'}}}};
const {POST}=await loadService('app/api/webhooks/stripe/route.ts',{
 NextResponse:{json:Response.json},fundingMode:()=>mode,
 fundingStripe:()=>({webhooks:{constructEvent:(_body,signature)=>{if(signature!=='valid-fixture')throw Error('Invalid');return event;}}}),
 sendLegacyTrialReminder:async id=>{calls.push(id);if(fail)throw Error('Private provider details');},
 schedulePurchaseAccessEmail:()=>assert.fail('A reminder is not a purchase receipt')
});
const post=(signature='valid-fixture')=>POST(new Request('https://www.geticashx.com/api/webhooks/stripe',{method:'POST',headers:{'stripe-signature':signature},body:'fixture'}));
assert.equal((await post('invalid')).status,400);assert.deepEqual(calls,[]);
event.livemode=false;assert.equal((await post()).status,400);assert.deepEqual(calls,[]);event.livemode=true;
assert.equal((await post()).status,200);assert.deepEqual(calls,['sub_fixture'],'Only subscription ID is passed; event email is not trusted');
fail=true;const response=await post();assert.equal(response.status,500);assert(!JSON.stringify(await response.json()).includes('Private'));
fail=false;assert.equal((await post()).status,200,'Delivery failures remain retryable');
mode=null;assert.equal((await post()).status,503);
console.log('PASS trial reminder webhook: signed-event and payment-mode gates, canonical ID-only handoff, retryable failure, no purchase receipt or leaked provider detail. Fixture only.');
