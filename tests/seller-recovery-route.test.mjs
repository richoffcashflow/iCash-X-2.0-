import assert from 'node:assert/strict';
import {z} from 'zod';
import {loadService} from './helpers/simulated-journey-services.mjs';
const account='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',actor='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',gap='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
let authenticated=true,origin=true,saved=true,reads=0,writes=[];
const route=await loadService('app/api/work/seller-recovery/route.ts',{z,NextResponse:{json:Response.json},allowedOrigin:()=>origin,workAccount:async()=>{if(!authenticated)throw Error('SIGN_IN_REQUIRED');return {accountId:account,userId:actor};},db:async(path,method,body)=>{
 if(method==='POST'){assert.equal(path,'rpc/icash_review_seller_gap');writes.push(body);assert.equal(body.p_account,account);assert.equal(body.p_actor,actor);return saved;}
 reads++;assert(path.includes('account_id=eq.'+account));assert(path.endsWith('limit=100'));return [{id:gap,reason:'owners'}];
}});
const input={id:gap,version:'2026-10-09T21:00:00Z',resolution:'Confirmed both required owners will participate.'};
const req=(body=input)=>new Request('https://fixture.invalid/api/work/seller-recovery',{method:'POST',body:JSON.stringify(body)});
authenticated=false;assert.equal((await route.GET()).status,400);assert.equal(reads,0);assert.equal((await route.POST(req())).status,400);assert.equal(writes.length,0);
authenticated=true;origin=false;assert.equal((await route.POST(req())).status,403);assert.equal(writes.length,0);origin=true;
assert.equal((await route.POST(req({...input,accountId:'someone-else'}))).status,400);assert.equal(writes.length,0);
const list=await route.GET();assert.equal(list.headers.get('Cache-Control'),'private, no-store');assert.equal((await list.json()).gaps[0].id,gap);
assert.equal((await route.POST(req())).status,200);assert.equal(writes[0].p_version,input.version);
saved=false;assert.equal((await route.POST(req())).status,409);
console.log('PASS recovery review route: tenant ownership, origin, bounded reads, version check and durable resolution.');
