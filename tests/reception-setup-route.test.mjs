import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {receptionTarget,boundedBody} from '../lib/general-reception.ts';
let who='owner',events=[];
const ready={status:'review',actions:[],checks:{},blockers:[]};
const route=await loadService('app/api/owner-reception/setup/route.ts',{
 NextResponse:{json:Response.json},receptionTarget,boundedBody,process:{env:{}},
 workAccount:async()=>{if(who==='signed_out')throw Error('SIGN_IN_REQUIRED');return {accountId:who==='wrong_account'?'other':receptionTarget.accountId,userId:who==='wrong_user'?'other':receptionTarget.ownerUserId};},
 db:async()=>{assert.fail('stubbed provider functions should not call db');},
 reviewReceptionSetup:async()=>{events.push('review');return ready;},
 applyReceptionSetup:async(_,__,action,token)=>{events.push({action,token});return {status:'verified'};},
});
const url='https://app.test/api/owner-reception/setup',token='signed_review';
const request=(method='GET',change={})=>new Request(change.url??url,{method,headers:{host:'app.test',...(method==='POST'?{origin:'https://app.test','content-type':'application/json'}:{}),...change.headers},...(method==='POST'?{body:change.body??JSON.stringify({action:'prepare_branch',confirm:true,reviewToken:token})}:{})});
for(const role of ['signed_out','wrong_account','wrong_user']){who=role;for(const method of ['GET','POST'])assert.equal((await route[method](request(method))).status,role==='signed_out'?401:403);}who='owner';assert.deepEqual(events,[]);
for(const method of ['GET','POST'])for(const change of [{url:url+'?url=https://foreign.test'},{headers:{host:'foreign.test'}},{headers:{origin:'https://foreign.test'}},{headers:{'sec-fetch-site':'cross-site'}}])assert((await route[method](request(method,change))).status>=400);
for(const body of ['null','{}','[]','invalid','x'.repeat(5000),JSON.stringify({action:'prepare_branch',confirm:false,reviewToken:token}),JSON.stringify({action:'prepare_branch',confirm:true,reviewToken:token,url:'https://foreign.test'}),JSON.stringify({action:'proxy',confirm:true,reviewToken:token}),JSON.stringify({action:'prepare_branch',confirm:true,reviewToken:token,call_profile:'owner_quick_test'}),JSON.stringify({action:'route',confirm:true,reviewToken:42})])assert.equal((await route.POST(request('POST',{body}))).status,400);
assert.equal((await route.POST(request('POST',{headers:{origin:''}}))).status,403);
assert.equal((await route.POST(request('POST',{headers:{'content-type':'text/plain'}}))).status,415);
assert.equal((await route.POST(request('POST',{headers:{'content-length':'not-number'}}))).status,400);assert.deepEqual(events,[]);
let res=await route.GET(request());assert.deepEqual(await res.json(),ready);assert.equal(res.headers.get('cache-control'),'private, no-store, max-age=0');assert.deepEqual(events,['review']);
res=await route.POST(request('POST'));assert.equal(res.status,200);assert.deepEqual(events,['review',{action:'prepare_branch',token}]);
for(const action of ['configure_branch','route','restore']){res=await route.POST(request('POST',{body:JSON.stringify({action,confirm:true,reviewToken:token})}));assert.equal(res.status,200);assert.equal(events.at(-1).action,action);}
assert.equal(route.DELETE,undefined);assert.equal(route.PATCH,undefined);
const ui=readFileSync('app/owner-reception/reception-setup.tsx','utf8'),page=readFileSync('app/owner-reception/page.tsx','utf8');assert(ui.includes('if(running.current)return'));assert(ui.includes('Confirm change'));assert(ui.includes('Cancel'));assert(ui.includes("setReview(null)"));assert(!ui.includes('localStorage'));assert(!ui.includes('process.env'));assert(ui.includes("data.status==='no_call'"));assert(!ui.includes("r.ok?'Provider receipt check completed"));
const reconcile=ui.match(/fetch\('\/api\/owner-reception\/reconcile',\{([^}]+)\}/)?.[1];assert(reconcile);assert(!reconcile.includes('body'));assert(reconcile.includes("credentials:'same-origin'"));assert(page.includes('index:false'));assert(ui.includes('review.profile.maxDurationSeconds'));assert(ui.includes('review.profile.customerChargeCapCents'));assert(ui.includes('Owner-only quick test'));assert(!ui.includes('60-second limit'));
const sql=readFileSync('config/general-reception-setup.sql','utf8');assert(sql.includes('enable row level security'));assert(!sql.includes('max_duration_seconds=60'));for(const key of ['call_profile','rate_id','max_duration_seconds','customer_charge_cap_cents'])assert(sql.includes("p_result->"+(key==='max_duration_seconds'||key==='customer_charge_cap_cents'?"'":">'")+key));assert(sql.includes('action text primary key'));assert(sql.includes("state text not null default 'started'"));assert(sql.includes("where id=1 for update"));assert(!/enabled\s*=\s*true/i.test(sql));assert(!/create (?:or replace )?function[^;]+set\s+enabled/i.test(sql));assert(sql.includes('grant execute on function public.icash_get_reception_setup() to service_role'));
const upgrade=readFileSync('config/general-reception-profile-setup-upgrade.sql','utf8'),legacy=readFileSync('tests/fixtures/reception-setup-preprofiles.sql','utf8');assert(upgrade.includes('create or replace function public.icash_complete_reception_setup'));assert(!/create table|drop |truncate |delete from|grant |revoke /i.test(upgrade));assert(upgrade.includes("p_result->>'call_profile' is distinct from c.call_profile"));assert(legacy.includes("max_duration_seconds=60"));
console.log('Reception setup route/UI: exact owner, CSRF, bounded fixed-action requests, explicit confirmation, no-argument receipt check, truthful completion status and durable SQL guard structure');
