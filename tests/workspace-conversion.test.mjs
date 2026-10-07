import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {workspaceConversionOffer} from '../lib/workspace-conversion.ts';
const base={balanceCents:1000,paused:false,billingReview:false,identityReady:true,membershipActive:true,canFund:true,autoRechargeEnabled:false,recentPurchase:false,queuedResearch:0,completedResearch:0,vipAvailable:true,vip:false};
assert.equal(workspaceConversionOffer(base).action,'vip');
assert.equal(workspaceConversionOffer({...base,vip:true}),null);
assert.equal(workspaceConversionOffer({...base,vipAvailable:false}),null);
assert.equal(workspaceConversionOffer({...base,recentPurchase:true}),null);
assert.equal(workspaceConversionOffer({...base,paused:true}).action,'resume');
for(const balanceCents of [0,1,499])assert.equal(workspaceConversionOffer({...base,balanceCents}).action,'funding');
assert.equal(workspaceConversionOffer({...base,balanceCents:500}).action,'vip');
const offer=workspaceConversionOffer({...base,balanceCents:0,queuedResearch:1});
assert.match(offer.title,/research is queued/);assert.equal(offer.amountCents,2500);assert.doesNotMatch(offer.detail,/finish|complete|guarantee/);
assert.doesNotMatch(workspaceConversionOffer({...base,balanceCents:0}).detail,/queue|saved/);
for(const bad of [{billingReview:true},{identityReady:false},{membershipActive:false},{balanceCents:NaN},{balanceCents:-1},{queuedResearch:Infinity}])assert.equal(workspaceConversionOffer({...base,...bad}),null);
assert.equal(workspaceConversionOffer({...base,balanceCents:0,canFund:false}),null);
assert.equal(workspaceConversionOffer({...base,balanceCents:0,autoRechargeEnabled:true}),null);
let signedIn=true,mode='live',failure=false,paths=[],snapshot={accountId:'owned',account:{balanceCents:0,paused:false,billingReview:false,identity:{principal:'Fixture'},billingModel:'membership_credits'}},vip=false;
const deps={NextResponse:{json:(body,options={})=>({body,status:options.status??200})},currentUser:async()=>signedIn?{id:'user'}:null,accountMode:()=>mode,db:async(path,method,body)=>{
 paths.push({path,method,body});if(failure)throw Error();
 if(path==='rpc/icash_load_workspace_account'){assert.equal(body.p_user,'user');return snapshot;}
 assert(path.includes('account_id=eq.owned'),'Every record query is bound to authenticated account');
 if(path.startsWith('icash_screening_jobs'))return [{id:'work'}];
 if(path.startsWith('icash_auto_recharges'))return [{enabled:false}];
 if(path.startsWith('icash_funding_orders'))return [];
 throw Error('Unexpected query '+path);
},accountMembership:async id=>{assert.equal(id,'owned');return {state:'active'};},membershipAccessible:()=>true,publicMembership:()=>({vip,accessible:true,priceCents:5000}),customerFundingReady:async()=>true,workspaceConversionOffer};
globalThis.__conversion=deps;
const src=ts.transpileModule(readFileSync(new URL('../app/api/work/next-action/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .*;\s*$/gm,'');
const {GET}=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.__conversion;\n'+src).toString('base64'));
assert.equal((await GET()).body.offer.action,'funding');
snapshot.account.balanceCents=2500;assert.equal((await GET()).body.offer.action,'vip');vip=true;assert.equal((await GET()).body.offer,null);
failure=true;assert.equal((await GET()).status,503);assert.equal((await GET()).body.offer,null);failure=false;
for(const state of ['guest','test']){paths=[];signedIn=state!=='guest';mode=state==='test'?'test':'live';assert.equal((await GET()).body.offer,null);assert.equal(paths.length,0);}
console.log('PASS conversion: funding/activation/VIP priority, verified queue copy, stale/invalid/account holds, recharge suppression, recent-purchase cooldown, authentication and account-scoped queries.');
