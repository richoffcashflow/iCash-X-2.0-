import assert from 'node:assert/strict';
import {inspectOwnerCapabilities} from '../scripts/check-dealmachine-owner-capabilities.mjs';
let calls=0;
assert.deepEqual(await inspectOwnerCapabilities({},()=>{throw Error('network');}),{status:'unconfigured',paidRequests:0});
const result=await inspectOwnerCapabilities({DEALMACHINE_API_KEY:'fixture-secret'},async(url,options)=>{
 calls++;assert.equal(options.method,'GET');assert.equal(options.body,undefined);assert.equal(options.redirect,'error');
 assert.equal(options.headers.Authorization,'Bearer fixture-secret');
 assert.equal(url,`https://api.v2.dealmachine.com/v1/filters?source_type=people&per_page=250&page=${calls}`);
 return Response.json({data:calls===1?[
  {filter_id:'has_active_phone_number',type:'BOOLEAN',allowed_operators:['is_boolean']},
  {filter_id:'unrelated',name:'private fixture'},
 ]:[{filter_id:'dm_person_id',type:'STRING',allowed_operators:['any_of']}],pagination:{has_next_page:calls===1}});
});
assert.equal(result.status,'checked');assert.equal(calls,2);assert.equal(result.paidRequests,0);
assert.deepEqual(result.filters.map(f=>f.filterId),['has_active_phone_number','dm_person_id']);
assert(!JSON.stringify(result).includes('fixture-secret'));assert(!JSON.stringify(result).includes('private fixture'));
assert.equal((await inspectOwnerCapabilities({DEALMACHINE_API_KEY:'fixture'},async()=>Response.json({error:'sensitive'},{status:401}))).status,'catalog_unavailable');
assert.equal((await inspectOwnerCapabilities({DEALMACHINE_API_KEY:'fixture'},async()=>Response.json({data:[]}))).status,'catalog_shape_unavailable');
calls=0;
assert.equal((await inspectOwnerCapabilities({DEALMACHINE_API_KEY:'fixture'},async()=>{calls++;return Response.json({data:[],pagination:{has_next_page:true}});})).status,'catalog_incomplete');
assert.equal(calls,4);
console.log('Owner capability inspection: bounded free catalog reads, pagination, exact selectors, no paid calls and sanitized output passed.');
