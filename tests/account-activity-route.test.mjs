import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
let paths=[],checks=0,signedIn=true,fullReady=true,smsReady=false,discoveryReady=false,contactReady=false,failSnapshot=false;
const snapshot={accountId:'account',account:{billingModel:'membership_credits',membership:{state:'active',paid_through:'2099-01-01'},balanceCents:800,reservedCents:200,paused:false,activeWork:true,billingReview:false,identity:{principal:'Fixture'}}};
const receipts=[];const mocks={after:fn=>void fn(),recordSoftwareAccess:async(req,account,user)=>receipts.push({req,account,user}),membershipAccessible:m=>m?.state==='active'&&Date.parse(m.paid_through)>Date.now(),ownerInboundTarget:{ownerUserId:'owner-admin'},resolveRequestedPropertyMarket:async()=>{checks++;return {status:'not_requested'};},contactAccountReadiness:async()=>{checks++;return {ready:contactReady,quote:contactReady?{chargeCents:174,maxContacts:25}:null};},discoveryAccountReadiness:async()=>{checks++;return {ready:discoveryReady,quote:discoveryReady?{chargeCents:84,maxProperties:5}:null};},liveWorkReady:()=>fullReady,smsAccountReady:async()=>{checks++;return smsReady;},launchReadiness:async()=>{checks++;return {ready:true};},accountMode:()=> 'live',currentUser:async()=>signedIn?{id:'user',email:'fixture@example.invalid'}:null,NextResponse:{json:(body,options={})=>({body,status:options.status??200})},db:async(path,method,body)=>{
 paths.push(path);if(path==='rpc/icash_vip_active'){assert.equal(method,'POST');assert.deepEqual(body,{p_account:'account'});return false;}assert.equal(path,'rpc/icash_load_workspace_account');assert.equal(method,'POST');assert.deepEqual(body,{p_user:'user',p_mode:'live'});if(failSnapshot)throw Error('private database details');return structuredClone(snapshot);
}};
globalThis.__accountActivity=mocks;
let source=ts.transpileModule(readFileSync(new URL('../app/api/account/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');source='const {'+Object.keys(mocks).join(',')+'}=globalThis.__accountActivity;\n'+source;
const {GET}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const core=()=>GET(new Request('https://www.geticashx.com/api/account?view=core'));
let r=await core();assert.equal(r.status,200);assert.equal(paths.length,2);assert.equal(paths.filter(p=>p==='rpc/icash_load_workspace_account').length,1);assert.equal(checks,0);assert.equal(r.body.balanceCents,800);assert.equal(r.body.activeWork,true);assert.equal(r.body.membershipActive,true);assert.equal(r.body.readinessPending,true);assert.equal(r.body.workReady,false);assert(!('accountId' in r.body));assert(!('membership' in r.body));
r=await GET();assert.equal(r.body.workReady,true);assert.equal(checks,5);
fullReady=false;smsReady=true;assert.equal((await GET()).body.smsWorkReady,true);
discoveryReady=true;contactReady=true;r=await GET();assert.equal(r.body.discoveryQuote.chargeCents,84);assert.equal(r.body.contactQuote.chargeCents,174);
for(const change of [{balanceCents:0},{billingReview:true},{membership:{state:'past_due',paid_through:'2099-01-01'}},{membership:{state:'active',paid_through:'2000-01-01'}}]){
 const previous=structuredClone(snapshot.account);Object.assign(snapshot.account,change);checks=0;r=await GET();assert.equal(r.status,200);assert.equal(checks,0);assert.equal(r.body.workReady,false);assert.equal(r.body.readinessPending,false);if(change.membership)assert.equal(r.body.membershipActive,false);snapshot.account=previous;
}
signedIn=false;paths=[];r=await core();assert.equal(r.body.signedIn,false);assert.equal(paths.length,0);signedIn=true;
const oldLog=console.error;let diagnostic;console.error=(...args)=>{diagnostic=args};failSnapshot=true;r=await core();console.error=oldLog;assert.equal(r.status,503);assert(!JSON.stringify(r.body).includes('private database'));assert.equal(diagnostic[1].stage,'account_snapshot');assert(!JSON.stringify(diagnostic).includes('private database'));
assert.equal(receipts[0].account,'account');assert.equal(receipts[0].user,'user');
delete globalThis.__accountActivity;
console.log('PASS account load: one snapshot plus scoped VIP check, deferred readiness, no empty-credit scans, membership lock, safe errors and exact saved balances.');
