import assert from 'node:assert/strict';
import { createDealMachinePreflight } from '../lib/dealmachine-preflight.ts';
const calls=[];
const client=createDealMachinePreflight('dm_sk_live_fixture',async(url,init)=>{
 calls.push({url,init});
 if(url.endsWith('/usage'))return Response.json({plan:{name:'Fixture',is_paid:true},billing_cycle:{start:'2026-09-01T00:00:00Z',end:'2026-10-01T00:00:00Z'},credits:{total_cap:30000,total_available:7,used:29993}});
 if(url.endsWith('/count'))return Response.json({total_properties:42,total_people:0,total_results:42});
 return Response.json({estimated_credits:{this_page:10,total_all_pages:42}});
});
assert.equal((await client.usage()).credits.total_available,7); // Never confuse allowance with balance.
await client.countProperties('75201');
await client.estimateProperties({zip:'75201'});
const body=JSON.parse(calls[2].init.body);
assert.equal(body.estimate_cost,true);
assert.equal(body.contact_audience,'none');
assert.equal(calls[1].url,'https://api.v2.dealmachine.com/v1/properties/search/count');
assert.equal(calls[2].init.redirect,'error');
await assert.rejects(()=>client.estimateProperties({zip:'75201',estimate_cost:false}));
await assert.rejects(()=>client.estimateProperties({zip:'75201',perPage:250}));
assert.equal(calls.length,3); // Invalid input never dispatches.
const blocked=createDealMachinePreflight('dm_sk_live_fixture',async()=>new Response('secret provider body',{status:429}));
await assert.rejects(()=>blocked.usage(),e=>e.status===429&&!e.message.includes('secret'));
const malformed=createDealMachinePreflight('dm_sk_live_fixture',async()=>Response.json({credits:{total_available:-1}}));
await assert.rejects(()=>malformed.usage());
console.log('DealMachine preflight safety checks passed (mock transport; no vendor calls)');
