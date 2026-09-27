import assert from 'node:assert/strict';
import { chooseDataProvider } from '../lib/data-router.ts';
const q=(name,cost,rate=1)=>({name,tasks:['property'],available:true,licensedForUse:true,supportsMarket:true,unitCostCents:cost,observedUsefulResultRate:rate,freshnessPassRate:1});
assert.equal(chooseDataProvider('property',[q('cheap-bad',2,.1),q('better',5,.9)])?.name,'better');
assert.equal(chooseDataProvider('property',[{...q('unlicensed',1),licensedForUse:false}]),null);
assert.equal(chooseDataProvider('contact',[q('property-only',1)]),null);
console.log('provider routing checks passed');
