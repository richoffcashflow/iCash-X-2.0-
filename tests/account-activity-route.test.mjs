import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {workspaceAcknowledgmentCurrent,workspaceAcknowledgmentHash} from '../lib/workspace-acknowledgment.ts';
import {workspaceAcknowledgmentVersion} from '../lib/workspace-acknowledgment-policy.ts';
let acknowledged=true,paths=[],checks=0,signedIn=true,fullReady=true,smsReady=false,discoveryReady=false,contactReady=false,failSnapshot=false,userId='user';
let authSignal,dbSignal;
const snapshot={accountId:'account',access:{vip:false,vipFeatures:false,adminPlan:null},workspaceAcknowledgment:{workspace_ack_version:workspaceAcknowledgmentVersion,workspace_ack_user_id:userId,workspace_ack_hash:workspaceAcknowledgmentHash},account:{billingModel:'membership_credits',membership:{state:'active',paid_through:'2099-01-01'},balanceCents:800,reservedCents:200,paused:false,activeWork:true,billingReview:false,identity:{principal:'Fixture'}}};
const receipts=[];const mocks={workspaceAcknowledgmentCurrent:(record,user)=>acknowledged&&workspaceAcknowledgmentCurrent(record,user),after:fn=>void fn(),recordSoftwareAccess:async(req,account,user)=>receipts.push({req,account,user}),membershipAccessible:m=>m?.state==='active'&&Date.parse(m.paid_through)>Date.now(),ownerInboundTarget:{ownerUserId:'owner-admin',accountId:'owner-account'},resolveRequestedPropertyMarket:async()=>{checks++;return {status:'not_requested'};},contactAccountReadiness:async()=>{checks++;return {ready:contactReady,quote:contactReady?{chargeCents:174,maxContacts:25}:null};},discoveryAccountReadiness:async()=>{checks++;return {ready:discoveryReady,quote:discoveryReady?{chargeCents:84,maxProperties:5}:null};},liveWorkReady:()=>fullReady,smsAccountReady:async()=>{checks++;return smsReady;},launchReadiness:async()=>{checks++;return {ready:true};},accountMode:()=> 'live',currentUser:async(refresh,signal)=>{assert.equal(refresh,true);authSignal=signal;return signedIn?{id:userId,email:'fixture@example.invalid'}:null;},NextResponse:{json:(body,options={})=>({body,status:options.status??200})},db:async(path,method,body,signal)=>{
 paths.push(path);dbSignal=signal;assert.equal(path,'rpc/icash_load_workspace_account','account display must not introduce any work or wallet mutation');assert.equal(method,'POST');assert.deepEqual(body,{p_user:userId,p_mode:'live'});if(failSnapshot)throw Error('private database details');return structuredClone(snapshot);
}};
globalThis.__accountActivity=mocks;
let source=ts.transpileModule(readFileSync(new URL('../app/api/account/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');source='const {'+Object.keys(mocks).join(',')+'}=globalThis.__accountActivity;\n'+source;
const {GET}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const core=()=>GET(new Request('https://www.geticashx.com/api/account?view=core'));
let r=await core();assert.equal(r.status,200);assert.equal(paths.length,1);assert.equal(paths.filter(p=>p==='rpc/icash_load_workspace_account').length,1);assert.equal(checks,0);assert.equal(r.body.balanceCents,800);assert.equal(r.body.activeWork,true);assert.equal(r.body.membershipActive,true);assert.equal(r.body.readinessPending,true);assert.equal(r.body.workReady,false);assert(!('accountId' in r.body));assert(!('membership' in r.body));
r=await GET();assert.equal(r.body.workReady,true);assert.equal(checks,5);
fullReady=false;smsReady=true;assert.equal((await GET()).body.smsWorkReady,true);
discoveryReady=true;contactReady=true;r=await GET();assert.equal(r.body.discoveryQuote.chargeCents,84);assert.equal(r.body.contactQuote.chargeCents,174);
for(const change of [{balanceCents:0},{billingReview:true},{membership:{state:'past_due',paid_through:'2099-01-01'}},{membership:{state:'active',paid_through:'2000-01-01'}}]){
 const previous=structuredClone(snapshot.account);Object.assign(snapshot.account,change);checks=0;r=await GET();assert.equal(r.status,200);assert.equal(checks,0);assert.equal(r.body.workReady,false);assert.equal(r.body.readinessPending,false);if(change.membership)assert.equal(r.body.membershipActive,false);snapshot.account=previous;
}
acknowledged=false;checks=0;const receiptCount=receipts.length;r=await core();assert.equal(r.body.workspaceAcknowledged,false);assert.equal(r.body.readinessPending,false);assert.equal(receipts.length,receiptCount);await GET();assert.equal(checks,0);acknowledged=true;
signedIn=false;paths=[];r=await core();assert.equal(r.body.signedIn,false);assert.equal(paths.length,0);signedIn=true;
const originalSnapshot=structuredClone(snapshot);
for(const scenario of [
 {name:'exact owner, paused and empty',user:'owner-admin',account:'owner-account',paused:true,balance:0,available:true},
 {name:'ordinary user',user:'user',account:'account',paused:true,balance:0,available:false},
 {name:'different user with owner account ID',user:'user',account:'owner-account',paused:true,balance:0,available:false},
 {name:'owner with different account ID',user:'owner-admin',account:'account',paused:true,balance:0,available:false},
 {name:'owner with actual funds',user:'owner-admin',account:'owner-account',paused:true,balance:500,available:false},
 {name:'owner with actual bot unpaused',user:'owner-admin',account:'owner-account',paused:false,balance:0,available:false},
]){
 userId=scenario.user;snapshot.accountId=scenario.account;snapshot.workspaceAcknowledgment.workspace_ack_user_id=userId;
 Object.assign(snapshot.account,{paused:scenario.paused,balanceCents:scenario.balance,activeWork:false});
 const before=structuredClone(snapshot);
 for(const request of [core,()=>GET(new Request('https://www.geticashx.com/api/account'))]){
  paths=[];checks=0;r=await request();
  assert.equal(r.status,200,scenario.name);assert(!('pretendBotAvailable' in r.body),scenario.name);
  assert.equal(r.body.balanceCents,scenario.balance,'display eligibility never changes real credits');
  assert.equal(r.body.paused,scenario.paused,'display eligibility never unpauses actual work');
  assert.equal(r.body.activeWork,false,'display eligibility never invents real activity');
  assert.equal(paths.length,1,'one user-bound snapshot includes VIP and acknowledgment without extra network calls');
  assert.deepEqual(snapshot,before,'display eligibility leaves stored account state unchanged');
  if(scenario.balance===0){assert.equal(checks,0,'no provider readiness or provisioning for a pretend balance');assert.equal(r.body.workReady,false);assert.equal(r.body.readinessPending,false);}
 }
}
userId='user';Object.assign(snapshot,originalSnapshot);
// All core authorization flags come from the same user-bound snapshot. Missing
// or malformed flags fail closed; valid null acknowledgment means not accepted.
const realError=console.error;console.error=()=>{};
for(const malformed of [
 {access:undefined},{access:null},{access:[]},{access:{vip:false,vipFeatures:false}},
 {access:{vip:'true',vipFeatures:false,adminPlan:null}},{access:{vip:false,vipFeatures:'true',adminPlan:null}},
 {access:{vip:false,vipFeatures:false,adminPlan:'owner'}},{workspaceAcknowledgment:undefined},
 {workspaceAcknowledgment:null},{workspaceAcknowledgment:[]},{workspaceAcknowledgment:{}},
 {workspaceAcknowledgment:{...originalSnapshot.workspaceAcknowledgment,workspace_ack_user_id:1}},
]){
 Object.assign(snapshot,structuredClone(originalSnapshot),malformed);paths=[];checks=0;
 const receiptCount=receipts.length;r=await core();
 assert.equal(r.status,503);assert.equal(paths.length,1);assert.equal(checks,0);assert.equal(receipts.length,receiptCount);
 assert(!('signedIn' in r.body));assert(!('vipFeatures' in r.body));
}
console.error=realError;
for(const acknowledgment of [
 {workspace_ack_version:null,workspace_ack_user_id:null,workspace_ack_hash:null},
 {...originalSnapshot.workspaceAcknowledgment,workspace_ack_user_id:'another-user'},
 {...originalSnapshot.workspaceAcknowledgment,workspace_ack_hash:'wrong-hash'},
 {...originalSnapshot.workspaceAcknowledgment,workspace_ack_version:'old-version'},
]){
 Object.assign(snapshot,structuredClone(originalSnapshot),{workspaceAcknowledgment:acknowledgment});checks=0;
 const receiptCount=receipts.length;r=await core();assert.equal(r.status,200);assert.equal(r.body.workspaceAcknowledged,false);
 assert.equal(r.body.readinessPending,false);assert.equal(checks,0);assert.equal(receipts.length,receiptCount);
}
Object.assign(snapshot,structuredClone(originalSnapshot));
snapshot.access={vip:true,vipFeatures:true,adminPlan:'vip',unexpectedPrivate:'never exposed'};
r=await core();assert.equal(r.body.vip,true);assert.equal(r.body.vipFeatures,true);assert.equal(r.body.adminPlan,'vip');
for(const key of ['access','workspaceAcknowledgment','workspace_ack_hash','unexpectedPrivate'])assert(!(key in r.body));
Object.assign(snapshot,structuredClone(originalSnapshot));
const controller=new AbortController(),request=new Request('https://www.geticashx.com/api/account?view=core',{signal:controller.signal});
paths=[];r=await GET(request);assert.equal(r.status,200);assert.equal(paths.length,1);
assert.equal(authSignal,request.signal);assert.equal(dbSignal,request.signal);controller.abort();assert(authSignal.aborted);assert(dbSignal.aborted);
const oldLog=console.error;let diagnostic;console.error=(...args)=>{diagnostic=args};failSnapshot=true;r=await core();console.error=oldLog;assert.equal(r.status,503);assert(!JSON.stringify(r.body).includes('private database'));assert.equal(diagnostic[1].stage,'account_snapshot');assert(!JSON.stringify(diagnostic).includes('private database'));
assert.equal(receipts[0].account,'account');assert.equal(receipts[0].user,'user');
delete globalThis.__accountActivity;
console.log('PASS account load: scoped reads, deferred readiness, exact saved balances, membership lock, safe errors, and real owner balance and status without display-only credits.');
