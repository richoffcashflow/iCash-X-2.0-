import assert from 'node:assert/strict';
import {coursePreviewContracts} from '../lib/course-preview-contracts.ts';
const contracts=coursePreviewContracts();
for(const [kind,html] of Object.entries(contracts)){
 assert.match(html,/FICTIONAL COURSE EXAMPLE/);assert.match(html,/NOT FOR SIGNATURE/);
 assert.match(html,/128 Sample Lane/);assert.match(html,/Sample Investor LLC/);
 assert.match(html,/FICTIONAL EXAMPLE/);assert.match(html,/<img .*src="data:image/);
 assert.doesNotMatch(html,/<script|<form|https?:\/\//,'contract previews are self-contained, inert samples');
 if(kind==='purchase'){assert.match(html,/Taylor Parker/);assert.match(html,/90000.00/);assert.match(html,/10\/30\/2026/);}
 else{assert.match(html,/Cedar Ridge Homes/);assert.match(html,/10000.00/);assert.match(html,/2000.00/);assert.doesNotMatch(html,/90000.00/,'the assignment keeps acquisition price out of the rendered form');}
}
console.log('PASS course contracts: real form renderer, coherent fictional amounts, blank signatures and unmistakable sample markings.');
