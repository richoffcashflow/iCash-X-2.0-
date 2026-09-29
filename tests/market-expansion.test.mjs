import test from 'node:test';
import assert from 'node:assert/strict';
import {marketCountBodies,marketCounts,marketLocations} from '../lib/market-expansion.ts';
test('screens equity before buying records; buyer count remains a proxy',()=>{
 const bodies=marketCountBodies('75217',new Date('2026-09-29T00:00:00Z'));
 assert.equal(bodies.length,3);
 assert.equal(bodies[1].filters[1].value,70);
 assert.equal(bodies[2].anchor,'people');
 assert.equal(bodies[2].contact_audience,'owners');
 assert.equal(bodies[2].filters[2].value,'2025-09-29');
 assert.throws(()=>marketCountBodies('75217 OR 1=1'));
});
test('rejects invalid provider responses',()=>{
 assert.equal(marketCounts.safeParse({total_properties:-1,total_people:0,total_results:0}).success,false);
 assert.equal(marketLocations.safeParse({data:[{type:'city',code:'Dallas',state:'TX',name:'Dallas',property_count:1}],pagination:{page:1,total_pages:1}}).success,false);
});
