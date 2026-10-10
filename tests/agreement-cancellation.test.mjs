import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';
import {cancellationEvidence} from '../lib/agreement-cancellation-policy.ts';
import {dealCardSummary} from '../lib/deal-card-summary.ts';
import {needsAttention,propertyGroup} from '../components/workspace-view.ts';

const account='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',actor='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',deal='cccccccc-cccc-4ccc-8ccc-cccccccccccc',id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const envelope={id,account_id:account,deal_id:deal,kind:'assignment',provider_id:'123',state:'cancellation_pending',test_mode:false,terms_hash:'a'.repeat(64),recipients:[{id:'1',email:'buyer@example.invalid'},{id:'2',email:'owner@example.invalid'}]};
const provider=(count=0,expired=false)=>({id:123,submitters_order:'preserved',completed_at:count===2?'2026-10-01T12:00:01Z':null,expire_at:expired?'2026-10-01T12:01:00Z':null,submitters:envelope.recipients.map((r,index)=>({id:index+1,submission_id:123,email:r.email,external_id:`${id}:${r.id}`,status:index<count?'completed':'awaiting',completed_at:index<count?`2026-10-01T12:00:0${index}Z`:null,slug:'fixture',metadata:{terms_hash:envelope.terms_hash}}))});
assert.deepEqual(cancellationEvidence(provider(0,true),envelope),{outcome:'expired',signed:false});
assert.deepEqual(cancellationEvidence(provider(1,true),envelope),{outcome:'expired',signed:true});
assert.deepEqual(cancellationEvidence(provider(2),envelope),{outcome:'completed',signed:true});
assert.equal(cancellationEvidence({...provider(),expire_at:'2099-01-01T00:00:00Z'},envelope).outcome,'active');
assert.throws(()=>cancellationEvidence({...provider(),id:456},envelope),/evidence mismatch/);
const wrong=provider();wrong.submitters[0].email='other@example.invalid';assert.throws(()=>cancellationEvidence(wrong,envelope),/Signer evidence mismatch/);

const load=async(file,binding,values)=>{
 globalThis[binding]=values;
 const source=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
 return import('data:text/javascript;base64,'+Buffer.from(`const {${Object.keys(values).join(',')}}=globalThis.${binding};\n`+source).toString('base64'));
};
const {reconcileCancellation}=await load('lib/agreement-cancellation-service.ts','__cancellationService',{cancellationEvidence,db:()=>{throw Error('Live database prohibited');}});
let saved=[],calls=[],recordState='pending',current=envelope,response=provider(),fail=false,expiryWorks=true;
const deps={db:async(path,method,body)=>{
 assert(path==='rpc/icash_record_cancellation_check'||path.includes(`account_id=eq.${account}`));
 if(path.startsWith('icash_agreement_cancellations'))return [{id,deal_id:deal,state:recordState,snapshot:[{id}]}];
 if(path.startsWith('icash_signing_envelopes'))return [current];
 if(path==='rpc/icash_record_cancellation_check'){saved.push(body);return null;}
 throw Error('Unexpected fixture call '+path);
},providerRequest:async(providerId,test,expire=false)=>{
 calls.push({providerId,test,expire});if(fail)throw Error('Fixture timeout');
 if(expire&&expiryWorks)response={...response,expire_at:'2026-10-01T12:01:00Z'};
 return response;
}};
await reconcileCancellation(account,actor,id,deps);
assert.deepEqual(calls.map(c=>c.expire),[false,true,false]);assert.equal(saved.at(-1).p_outcome,'expired');
calls=[];await reconcileCancellation(account,actor,id,deps);assert.equal(calls.length,1,'retry verifies expiry without resending an agreement');
calls=[];response=provider(2);await reconcileCancellation(account,actor,id,deps);assert.equal(calls.length,1);assert.equal(saved.at(-1).p_outcome,'completed');assert.equal(saved.at(-1).p_signed,true);
response=provider(1);await reconcileCancellation(account,actor,id,deps);assert.equal(saved.at(-1).p_signed,true,'partial signatures require a release');
fail=true;await reconcileCancellation(account,actor,id,deps);assert.equal(saved.at(-1).p_outcome,'error');fail=false;
response=provider();expiryWorks=false;await reconcileCancellation(account,actor,id,deps);assert.equal(saved.at(-1).p_outcome,'error','unconfirmed expiry cannot finish');expiryWorks=true;
response={...provider(),id:456};calls=[];await reconcileCancellation(account,actor,id,deps);assert.equal(calls.length,1);assert.equal(saved.at(-1).p_outcome,'error','foreign document is never modified');
current={...envelope,provider_id:null};calls=[];await reconcileCancellation(account,actor,id,deps);assert.equal(calls.length,0);assert.equal(saved.at(-1).p_outcome,'error','ambiguous creation remains held');
recordState='completed';saved=[];await reconcileCancellation(account,actor,id,deps);assert.equal(saved.length,0);

let writes=[],reconciles=0,signedIn=true,stale=false,view={revision:'a'.repeat(32),stage:'cancellation_pending',hasAssignment:true,blocked:false,requests:[]};
const route=await load('app/api/work/cancellations/route.ts','__cancellationRoute',{
 z,NextResponse:{json:(data,options)=>Response.json(data,options)},allowedOrigin:r=>r.headers.get('Origin')==='https://www.geticashx.com',
 workAccount:async(options)=>{assert.equal(options.allowInactiveMembership,true,'cancellation does not require active billing');if(!signedIn)throw Error();return {accountId:account,userId:actor};},
 cancellationView:async(a,u,d)=>{assert.equal(a,account);assert.equal(u,actor);assert.equal(d,deal);return view;},
 reconcileCancellation:async(a,u,c)=>{assert.deepEqual([a,u,c],[account,actor,id]);reconciles++;return deal;},
 db:async(path,method,body)=>{writes.push({path,body});assert.equal(body.p_account,account);assert.equal(body.p_actor,actor);if(stale)throw Error('Sensitive database details');return path==='rpc/icash_request_cancellation'?id:false;}
});
const body={action:'request',dealId:deal,kind:'assignment',reason:'Buyer withdrew',key:id,revision:'a'.repeat(32),confirmed:true};
const request=(value,origin='https://www.geticashx.com')=>new Request('https://www.geticashx.com/api/work/cancellations',{method:'POST',headers:{Origin:origin},body:JSON.stringify(value)});
const success=await route.POST(request(body));assert.equal(success.status,200);assert.equal(success.headers.get('Cache-Control'),'private, no-store');assert.equal(reconciles,1);assert.equal(writes[0].path,'rpc/icash_request_cancellation');assert.equal(writes[1].body.p_confirmed,false,'request cannot attest to a signed release');
writes=[];reconciles=0;
assert.equal((await route.POST(request(body,'https://evil.invalid'))).status,403);
for(const invalid of [{...body,accountId:account},{...body,confirmed:false},{...body,reason:'x'},{...body,revision:'stale'},{action:'complete',id,confirmed:true,releaseReference:'',resolutionReference:''}])assert.equal((await route.POST(request(invalid))).status,409);
signedIn=false;assert.equal((await route.POST(request(body))).status,409);signedIn=true;assert.equal(writes.length,0);assert.equal(reconciles,0);
stale=true;const error=await route.POST(request(body));assert.equal(error.status,409);assert(!JSON.stringify(await error.json()).includes('Sensitive'));assert.equal(reconciles,0);stale=false;
const result=await route.POST(request({action:'complete',id,confirmed:true,releaseReference:'Signed mutual release 123',resolutionReference:'Title confirmed deposit disposition'}));assert.equal(result.status,200);assert.equal(writes.at(-1).body.p_confirmed,true);
assert.equal((await route.GET(new Request(`https://www.geticashx.com/api/work/cancellations?dealId=${deal}`))).status,200);
const evidence={deals:[{id:deal,screening_id:id,stage:'cancellation_pending'}],signing:[],handoffs:[]};
assert.equal(needsAttention(id,evidence),true);assert.equal(dealCardSummary({id:deal,stage:'cancellation_pending',terms:{priceCents:10000}},[]).status,'Cancellation pending');
assert.equal(propertyGroup(id,{...evidence,deals:[{...evidence.deals[0],stage:'cancelled'}]}),'history');
console.log('PASS cancellation policy, provider reconciliation, authenticated routes and workspace state; fixtures only, no paid provider calls.');
