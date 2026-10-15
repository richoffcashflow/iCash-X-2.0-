import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {usageLoopCard} from '../lib/usage-loop-policy.ts';
import {reliabilitySchema} from '../lib/reliability.ts';
let signedIn=true,mode='live',failure=false,trackingFails=false,paths=[],observations=0;
const stamp=new Date().toISOString();
const evidence={checkedAt:stamp,progress:{kind:'seller_reply',count:1,lastAt:stamp},work:{kind:'seller_followup',count:1,estimateCents:1200},hasHistory:true,needsReview:false,ready:true,hasDeal:false};
let snapshot={accountId:'owned',account:{balanceCents:0,paused:false,billingReview:false,identity:{principal:'Fixture'},billingModel:'membership_credits'}},membershipActive=true;
let reliability={status:'ok',fresh:true,components:{worker:{status:'ok',checkedAt:stamp},maintenance:{status:'ok',checkedAt:stamp}},snapshot:null};
const deps={NextResponse:{json:(body,options={})=>({body,status:options.status??200})},currentUser:async()=>signedIn?{id:'user'}:null,accountMode:()=>mode,
 db:async(path,method,body)=>{paths.push(path);if(failure)throw Error('Unavailable');if(path==='rpc/icash_load_workspace_account'){assert.equal(body.p_user,'user');return snapshot;}
  if(path==='rpc/icash_reliability_status')return reliability;
  if(path==='rpc/icash_workspace_vip_access'){assert.equal(body.p_account,'owned');return {vip:false};}
  assert(path.includes('account_id=eq.owned'),'Every record is account scoped');
  if(path.startsWith('icash_funding_orders'))return [];
  if(path.startsWith('icash_auto_recharges'))return [{enabled:false}];throw Error(path);
 },
 accountMembership:async id=>{assert.equal(id,'owned');return {state:'active'};},membershipAccessible:()=>membershipActive,publicMembership:()=>({vip:false,accessible:true,priceCents:5000}),customerFundingReady:async()=>true,
 creditRefillContext:async(id,m,b)=>{assert.equal(id,'owned');return {amountCents:5000,lowBalanceCents:1000,available:true};},
 loadUsageLoopContext:async(id,user)=>{assert.deepEqual([id,user],['owned','user']);return evidence;},
 usageLoopCard,reliabilitySchema,usageLoopVariant:()=> 'progress',createUsageLoopObservation:async(id,card)=>{assert.equal(id,'owned');assert(card.reason);observations++;return trackingFails?null:{impressionId:'10000000-0000-4000-8000-000000000001',variant:'progress'};},
};
const previousEnv=process.env.VERCEL_ENV;process.env.VERCEL_ENV='production';
globalThis.__usageLoopRoute=deps;
const source=ts.transpileModule(readFileSync(new URL('../app/api/work/next-action/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .*;\s*$/gm,'');
const {GET}=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.__usageLoopRoute;\n'+source).toString('base64'));
try{
 let r=await GET();assert.equal(r.body.card.action,'funding');assert.equal(r.body.card.amountCents,1500);assert(r.body.impressionId);assert.equal(r.body.variant,'progress');assert.equal(r.body.offer,null);
 trackingFails=true;r=await GET();assert.equal(r.body.card.action,'funding');assert.equal(r.body.impressionId,null,'Telemetry failure cannot break payment navigation');trackingFails=false;
 reliability={...reliability,components:{...reliability.components,worker:{status:'degraded',checkedAt:stamp}}};assert.notEqual((await GET()).body.card?.action,'funding');
 failure=true;assert.equal((await GET()).status,503);assert.equal((await GET()).body.card,null);failure=false;
 for(const state of ['guest','test']){paths=[];signedIn=state!=='guest';mode=state==='test'?'test':'live';assert.equal((await GET()).body.card,null);assert.equal(paths.length,0);}
 signedIn=true;mode='live';membershipActive=false;const before=observations;assert.equal((await GET()).body.card,null);assert.equal(observations,before,'Locked accounts never enter the loop');
}finally{delete globalThis.__usageLoopRoute;if(previousEnv===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=previousEnv;}
console.log('PASS next-action route: owned evidence, work-based recommendation, optional tracking, preview/guest exclusion, reliability and membership suppression.');
