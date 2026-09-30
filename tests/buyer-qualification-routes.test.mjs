import assert from 'node:assert/strict';
import {z} from 'zod';
import * as policy from '../lib/buyer-qualification.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const account=uuid(1),user=uuid(2),deal=uuid(3),buyer=uuid(4),id=uuid(5);let calls=[],signedIn=true,operator=false,ownedDeal=true,rows=1;
const payload={buyerId:buyer,dealId:deal,markets:['Dallas'],propertyTypes:['house'],maxPriceCents:12000000,maxRepairCents:5000000,criteriaObservedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),sourceName:'Fixture buyer evidence',sourceReference:'Recorded buyer statement reference',buyerStatement:'Fixture unverified buyer statement with explicit provenance.'};
const row={id,account_id:account,buyer_id:buyer,deal_id:deal,entity_key:'fixture-buyer',state:'submitted',payload,created_at:payload.criteriaObservedAt,expires_at:payload.expiresAt,decision_note:null,reviewed_by:uuid(10),verification:{secret:'internal evidence'}};
const mocks={...policy,z,NextResponse:{json:(body,options={})=>({body,status:options.status??200,headers:options.headers})},workAccount:async()=>{if(!signedIn)throw Error('SIGN_IN_REQUIRED');return {accountId:account,userId:user};},requireTrustedOperator:async scope=>{assert.equal(scope,'authority_review');if(!operator)throw Error('OPERATOR_REQUIRED');return {userId:user};},db:async(path,method,body)=>{
 calls.push({path,method,body});
 if(path.startsWith('icash_deal_files'))return ownedDeal?[{id:deal}]:[];
 if(path.startsWith('icash_buyer_qualification_requests'))return Array.from({length:rows},()=>row);
 if(path==='rpc/icash_buyer_qualification_options'){assert.equal(body.p_account,account);assert.equal(body.p_deal,deal);return [{buyerId:buyer,name:'Fixture Buyer',entityKey:'fixture-buyer',qualificationState:'unreviewed',expiresAt:null}];}
 if(path==='rpc/icash_submit_buyer_qualification'){assert.equal(body.p_account,account);assert.equal(body.p_user,user);return row;}
 if(path==='rpc/icash_withdraw_buyer_qualification'){assert.equal(body.p_account,account);assert.equal(body.p_user,user);return null;}
 if(path==='rpc/icash_decide_buyer_qualification'){assert.equal(body.p_reviewer,user);return row;}
 throw Error('Unexpected database call '+path);
}};
const owner=await loadService('app/api/buyer-qualifications/route.ts',mocks),admin=await loadService('app/api/buyer-qualifications/admin/route.ts',mocks);
const req=(path,body,method='POST',origin='https://example.test')=>new Request('https://example.test'+path,{method,headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
let r=await owner.GET(new Request(`https://example.test/api/buyer-qualifications?dealId=${deal}`));assert.equal(r.status,200);assert.equal(r.body.requests[0].verification,undefined);assert(calls.every(c=>c.path.startsWith('rpc/')||c.path.includes('account_id=eq.'+account)));
rows=21;r=await owner.GET(new Request(`https://example.test/api/buyer-qualifications?dealId=${deal}&page=2`));assert.equal(r.body.hasMore,true);assert.equal(r.body.requests.length,20);assert(calls.some(c=>c.path.includes('offset=40')));rows=1;
calls=[];ownedDeal=false;r=await owner.GET(new Request(`https://example.test/api/buyer-qualifications?dealId=${deal}`));assert.equal(r.status,404);assert.equal(calls.length,1);ownedDeal=true;
calls=[];r=await owner.POST(req('/api/buyer-qualifications',{idempotencyKey:uuid(6),payload}));assert.equal(r.status,201);assert.equal(calls[0].path,'rpc/icash_submit_buyer_qualification');assert.equal(r.body.request.verification,undefined);
for(const bad of [{accountId:uuid(9),idempotencyKey:uuid(6),payload},{idempotencyKey:uuid(6),payload:{...payload,permitted:true}}]){calls=[];r=await owner.POST(req('/api/buyer-qualifications',bad));assert.equal(r.status,400);assert.equal(calls.length,0);}
calls=[];r=await owner.POST(req('/api/buyer-qualifications',{idempotencyKey:uuid(6),payload},'POST','https://attacker.test'));assert.equal(r.status,403);assert.equal(calls.length,0);
signedIn=false;r=await owner.GET(new Request(`https://example.test/api/buyer-qualifications?dealId=${deal}`));assert.equal(r.status,401);assert.equal(calls.length,0);signedIn=true;
r=await owner.DELETE(req('/api/buyer-qualifications',{requestId:id},'DELETE'));assert.equal(r.status,200);assert.equal(calls.at(-1).path,'rpc/icash_withdraw_buyer_qualification');
calls=[];r=await admin.GET(new Request('https://example.test/api/buyer-qualifications/admin'));assert.equal(r.status,403);assert.equal(calls.length,0);operator=true;
r=await admin.POST(req('/api/buyer-qualifications/admin',{requestId:id,decision:'approved',note:'Human review requested'}));assert.equal(r.status,400);assert.equal(calls.length,0);
const verification={criteriaConfirmed:true,fundsVerified:true,signatoryVerified:true,reviewReference:'Human review source reference',validUntil:payload.expiresAt,fundsReference:'Reviewed bank-source reference',fundsObservedAt:payload.criteriaObservedAt,fundsAmountCents:12000000,currency:'USD',signatoryName:'Fixture Authorized Signer',authorityReference:'Reviewed entity authority reference',authorityObservedAt:payload.criteriaObservedAt};
r=await admin.POST(req('/api/buyer-qualifications/admin',{requestId:id,decision:'approved',note:'Reviewed actual sources',verification:{...verification,rateId:uuid(9)}}));assert.equal(r.status,400);assert.equal(calls.length,0);
r=await admin.POST(req('/api/buyer-qualifications/admin',{requestId:id,decision:'approved',note:'Reviewed actual sources',verification}));assert.equal(r.status,200);assert.equal(calls.at(-1).path,'rpc/icash_decide_buyer_qualification');assert.equal(calls.at(-1).body.p_verification.rateId,undefined);
console.log('Buyer qualification routes: tenant-first reads, scoped pagination/withdrawal, strict claims, CSRF, signed-in owner and separate authority-review membership, no client quote/identity override passed.');
