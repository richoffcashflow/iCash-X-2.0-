import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';
import {createHash} from 'node:crypto';
import * as policy from '../lib/action-authority.ts';
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const account=uuid(1),user=uuid(2),requestId=uuid(3),screening=uuid(4);let calls=[],signedIn=true,operator=false,pdfCalls=0;
const payload={kind:'offer_ceiling',screeningId:screening,channel:'offer',maxCents:10000000,stateCode:'TX',purpose:'Authorize this maximum offer only',sourceName:'Recorded owner limit',evidenceReference:'Explicit owner bounded approval record',evidenceObservedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString()};
let row={id:requestId,account_id:account,kind:'offer_ceiling',screening_id:screening,state:'submitted',expires_at:payload.expiresAt,created_at:payload.evidenceObservedAt,decision_note:null,payload};
const mocks={...policy,z,createHash,NextResponse:{json:(body,options={})=>({body,status:options.status??200,headers:options.headers})},workAccount:async()=>{if(!signedIn)throw Error('SIGN_IN_REQUIRED');return {accountId:account,userId:user};},requireTrustedOperator:async()=>{if(!operator)throw Error('OPERATOR_REQUIRED');return {userId:user};},completedSigningPdf:async(a,id)=>{assert.equal(a,account);pdfCalls++;return new TextEncoder().encode('Actual fixture PDF bytes');},signingTermsHash:()=> 'a'.repeat(64),db:async(path,method,body)=>{
 calls.push({path,method,body});
 if(path==='rpc/icash_submit_authority_review'){assert.equal(body.p_account,account);assert.equal(body.p_user,user);return row;}
 if(path==='rpc/icash_withdraw_authority_review'){assert.equal(body.p_account,account);assert.equal(body.p_user,user);return null;}
 if(path==='rpc/icash_decide_authority_review'){assert.equal(body.p_reviewer,user);return row;}
 if(path.startsWith('icash_signing_envelopes'))return [{terms:{},terms_hash:'a'.repeat(64)}];
 if(path.startsWith('icash_authority_review_requests'))return [row];throw Error('Unexpected '+path);
}};
async function route(path,name){globalThis[name]=mocks;let source=ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');return import('data:text/javascript;base64,'+Buffer.from(`const {${Object.keys(mocks).join(',')}}=globalThis.${name};\n${source}`).toString('base64'));}
const owner=await route('app/api/authority-reviews/route.ts','__authorityOwner'),admin=await route('app/api/authority-reviews/admin/route.ts','__authorityAdmin');
const req=(path,body,method='POST',origin='https://example.test')=>new Request('https://example.test'+path,{method,headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
let r=await owner.GET(new Request('https://example.test/api/authority-reviews'));assert.equal(r.status,200);assert(calls[0].path.includes('account_id=eq.'+account));assert.equal(r.body.requests[0].status,'pending');
calls=[];r=await owner.POST(req('/api/authority-reviews',{idempotencyKey:uuid(9),payload}));assert.equal(r.status,201);assert.equal(calls.length,1);assert.equal(calls[0].path,'rpc/icash_submit_authority_review');
calls=[];r=await owner.POST(req('/api/authority-reviews',{idempotencyKey:uuid(9),payload,accountId:uuid(99)}));assert.equal(r.status,400);assert.equal(calls.length,0);
r=await owner.POST(req('/api/authority-reviews',{idempotencyKey:uuid(9),payload},'POST','https://attacker.test'));assert.equal(r.status,403);assert.equal(calls.length,0);
signedIn=false;r=await owner.POST(req('/api/authority-reviews',{idempotencyKey:uuid(9),payload}));assert.equal(r.status,401);assert.equal(calls.length,0);signedIn=true;
r=await owner.DELETE(req('/api/authority-reviews',{requestId},'DELETE'));assert.equal(r.status,200);assert.equal(calls.at(-1).path,'rpc/icash_withdraw_authority_review');
calls=[];r=await admin.GET(new Request('https://example.test/api/authority-reviews/admin'));assert.equal(r.status,403);assert.equal(calls.length,0);
r=await admin.POST(req('/api/authority-reviews/admin',{requestId,decision:'approved',note:'Spoofed user approval',verification:{}}));assert.equal(r.status,403);assert.equal(calls.length,0);operator=true;
r=await admin.POST(req('/api/authority-reviews/admin',{requestId,decision:'approved',note:'No reviewed evidence given'}));assert.equal(r.status,400);assert.equal(calls.length,0);
const verification={marketReviewId:uuid(8),reviewReference:'Real source review record',reviewedAt:new Date().toISOString(),validUntil:payload.expiresAt};
r=await admin.POST(req('/api/authority-reviews/admin',{requestId,decision:'approved',note:'Trusted review decision',verification:{...verification,signedDocumentHash:'fake'}}));assert.equal(r.status,400);assert.equal(calls.length,0);
row={...row,kind:'marketing_release',payload:{...payload,kind:'marketing_release',dealId:uuid(10),purchaseEnvelopeId:uuid(11),termsHash:'a'.repeat(64)}};
r=await admin.POST(req('/api/authority-reviews/admin',{requestId,decision:'approved',note:'Trusted review decision',verification}));assert.equal(r.status,200);assert.equal(pdfCalls,1);const approved=calls.at(-1);assert.equal(approved.path,'rpc/icash_decide_authority_review');assert.match(approved.body.p_verification.signedDocumentHash,/^[a-f0-9]{64}$/);assert.equal(approved.body.p_verification.signedDocumentHash,createHash('sha256').update('Actual fixture PDF bytes').digest('hex'));

row={...row,kind:'contact_permission',payload:{...payload,kind:'contact_permission',channel:'sms'}};
const smsVerification={...verification,smsConsentConfirmed:true,smsConsentBusiness:'Fixture principal',smsPriorContactReference:'Actual prior contact source',consentReference:'Actual SMS recipient consent',consentObservedAt:new Date().toISOString(),dncReceiptId:uuid(7)};
const oldFrom=process.env.CONTIGUITY_FROM;delete process.env.CONTIGUITY_FROM;calls=[];
r=await admin.POST(req('/api/authority-reviews/admin',{requestId,decision:'approved',note:'SMS source review completed',verification:smsVerification}));assert.equal(r.status,503);assert(!calls.some(c=>c.path==='rpc/icash_decide_authority_review'));
process.env.CONTIGUITY_FROM='+14243948384';calls=[];
r=await admin.POST(req('/api/authority-reviews/admin',{requestId,decision:'approved',note:'SMS source review completed',verification:smsVerification}));assert.equal(r.status,200);assert.equal(calls.at(-1).body.p_verification.smsSender,'+14243948384');
calls=[];r=await admin.POST(req('/api/authority-reviews/admin',{requestId,decision:'approved',note:'SMS source review completed',verification:{...smsVerification,smsSender:'+12145550123'}}));assert.equal(r.status,400);assert.equal(calls.length,0);
if(oldFrom===undefined)delete process.env.CONTIGUITY_FROM;else process.env.CONTIGUITY_FROM=oldFrom;
delete globalThis.__authorityOwner;delete globalThis.__authorityAdmin;
console.log('Authority routes: tenant-only reads/RPC, authenticated writes, same-origin CSRF, spoofed admin/IDs/hash rejection, provider PDF hash before atomic decision and owner withdrawal passed.');
