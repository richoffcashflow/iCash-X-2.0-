import assert from 'node:assert/strict';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {membershipAccessible} from '../lib/membership-policy.ts';
const purchase='00000000-0000-4000-8000-000000000001';
let user=null,rows=[],calls=[],account=true,destination='/live/100002',fail=false;
process.env.ICASH_AUTH_EMAIL_READY='true';
const {GET}=await loadService('app/api/account/access/route.ts',{currentUser:async()=>user,accountMode:()=> 'live',membershipAccessible,paidVipDestination:async()=>destination,db:async (path,method,body)=>{calls.push(path);if(fail)throw Error('Private error');if(path==='rpc/icash_claim_funding'){assert.equal(body.p_user,user.id);return 'owned-account';}if(path.startsWith('icash_accounts?'))return account?[{id:'owned-account'}]:[];assert(path.includes('account_id=eq.owned-account'));assert(path.includes('mode=eq.live'));return rows;}});
const get=query=>GET(new Request('https://www.geticashx.com/api/account/access'+(query?'?'+query:'')));
assert.deepEqual(await (await get()).json(),{signedIn:false,signInReady:true});assert.equal(calls.length,0,'Anonymous links reveal no purchase/account data');
assert.equal((await get('purchase=invalid')).status,400);
user={id:'verified-user',email:'buyer@example.invalid'};assert.deepEqual(await (await get()).json(),{signedIn:true,destination:'/'});
assert(calls.includes('rpc/icash_claim_funding'),'An existing verified account reclaims purchases that settled after sign-in');
let res=await get('purchase='+purchase);assert.equal(res.status,403);assert((await res.json()).error.includes('same email'));assert(calls.at(-1).includes('id=eq.'+purchase),'An emailed purchase is checked under the signed-in account');
rows=[{id:purchase,state:'active',paid_through:'2099-01-01'}];assert.equal((await (await get('purchase='+purchase)).json()).destination,'/');
assert.equal((await (await get('purchase='+purchase+'&destination=vip')).json()).destination,'/live/100002');
rows[0].state='needs_review';assert.equal((await get('purchase='+purchase+'&destination=vip')).status,403);rows[0].state='active';
destination=null;assert.equal((await get('purchase='+purchase+'&destination=vip')).status,409);
assert.equal((await (await get('destination=https://evil.invalid')).json()).destination,'/','No open redirect');
account=false;assert.equal((await get()).status,200);account=true;fail=true;res=await get();assert.equal(res.status,503);assert(!(await res.text()).includes('Private error'));
console.log('PASS purchase access: anonymous privacy, verified account scope, wrong-email recovery, membership reference, active VIP destination and no arbitrary redirect.');

// Payment arrives after an existing account signed in. The fresh claim must
// precede the purchase-scoped read instead of returning a wrong-email error.
let linked=false;
const late=await loadService('app/api/account/access/route.ts',{currentUser:async()=>user,accountMode:()=> 'live',membershipAccessible,paidVipDestination:async()=>'/live/100002',db:async(path,method,body)=>{
 if(path==='rpc/icash_claim_funding'){assert.equal(body.p_user,user.id);assert.equal(body.p_mode,'live');linked=true;return 'owned-account';}
 if(path.startsWith('icash_accounts?'))return [{id:'owned-account'}];
 assert(path.includes('account_id=eq.owned-account'));return linked?[{id:purchase,state:'active',paid_through:'2099-01-01'}]:[];
}});
const restored=await late.GET(new Request('https://www.geticashx.com/api/account/access?purchase='+purchase+'&destination=vip'));
assert.equal(restored.status,200);assert.equal((await restored.json()).destination,'/live/100002');
console.log('PASS late settlement attaches to an existing verified account before opening the emailed purchase.');
