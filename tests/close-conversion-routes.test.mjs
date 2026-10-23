import assert from 'node:assert/strict';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {dealRecoveryInput} from '../lib/deal-recovery.ts';
import {networkResponseSchema,networkProfileSchema,networkConsentVersion,networkError} from '../lib/buyer-network.ts';
const accountId='00000000-0000-4000-8000-000000000001',userId='00000000-0000-4000-8000-000000000002',dealId='00000000-0000-4000-8000-000000000003';
let signedIn=true;const calls=[];
const NextResponse={json:(data,init)=>Response.json(data,init)};
const {POST}=await loadService('app/api/work/deal-recovery/route.ts',{
 NextResponse,dealRecoveryInput,allowedOrigin:r=>r.headers.get('origin')===new URL(r.url).origin,
 workAccount:async()=>{if(!signedIn)throw Error('SIGN_IN_REQUIRED');return {accountId,userId};},
 db:async(path,method,body)=>{calls.push({path,body});return {editable:false};}
});
const input={dealId,key:dealId,termsHash:'a'.repeat(32),minimumFeeCents:800000,confirmed:true};
const request=(body=input,origin='https://example.test')=>new Request('https://example.test/api/work/deal-recovery',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
assert.equal((await POST(request())).status,200);assert.equal(calls.length,1);assert.deepEqual(calls[0],{path:'rpc/icash_authorize_deal_recovery',body:{p_account:accountId,p_actor:userId,p_deal:dealId,p_key:dealId,p_terms_hash:'a'.repeat(32),p_minimum:800000}});
calls.length=0;
for(const changes of [{confirmed:false},{minimumFeeCents:100000},{minimumFeeCents:800001},{accountId:dealId},{termsHash:'invalid'}])assert.equal((await POST(request({...input,...changes}))).status,409);
assert.equal((await POST(request(input,'https://untrusted.invalid'))).status,403);
signedIn=false;assert.equal((await POST(request())).status,409);assert.equal(calls.length,0);
const response=await loadService('app/api/buyer-network/route.ts',{
 NextResponse,networkResponseSchema,networkProfileSchema,networkError,currentUser:async()=>({id:userId}),limitRequest:async()=>{},
 db:async(path,method,body)=>{calls.push({path,body});return null;}
});
const feedback={matchId:dealId,state:'interested',key:dealId,reason:'price',counterofferCents:9000000};
assert.equal((await response.PATCH(request(feedback))).status,200);
assert.equal(calls[0].path,'rpc/icash_network_feedback');assert.equal(calls[0].body.p_user,userId);
assert.equal(networkResponseSchema.safeParse({...feedback,counterofferCents:9000001}).success,false);
assert.equal(networkResponseSchema.safeParse({...feedback,reason:'timing'}).success,false);
assert.equal(networkResponseSchema.safeParse({...feedback,key:undefined}).success,false);
const profile={name:'Fixture buyer',zips:['75201'],propertyTypes:['house'],maxPriceCents:10000000,maxRepairsCents:2000000,dailyEmails:1,availableDeals:null,accepted:true,consentVersion:networkConsentVersion};
assert.equal(networkProfileSchema.parse(profile).availableDeals,null);
for(const capacity of [-1,1.5,101])assert.equal(networkProfileSchema.safeParse({...profile,availableDeals:capacity}).success,false);
console.log('PASS session-bound recovery and feedback routes, origin checks, exact term receipt, explicit approval and integer money/capacity validation.');
