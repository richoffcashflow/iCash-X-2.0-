import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {creditRefillRecommendation} from '../lib/credit-refill-recommendation.ts';
let paths=[],failHistory=false,failUsage=false;
const db=async path=>{
 paths.push(path);assert(path.includes('account_id=eq.account'));
 if(path.startsWith('icash_funding_orders')){
  assert(path.includes('state=eq.paid')&&path.includes('auto_recharge=is.false')&&path.includes('credited_at=gt.')&&path.includes('limit=5'));
  if(failHistory)throw Error('history unavailable');
  return [{price_cents:7500,credited_at:new Date(Date.now()-1000).toISOString(),auto_recharge:false}];
 }
 assert(path.startsWith('icash_credit_ledger')&&path.includes('kind=eq.usage')&&path.includes('limit=1001'));
 if(failUsage)throw Error('usage unavailable');
 return [];
};
globalThis.__refillContext={db,creditRefillRecommendation};
let source=ts.transpileModule(readFileSync(new URL('../lib/credit-refill-context.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
source='const {db,creditRefillRecommendation}=globalThis.__refillContext;\n'+source;
const {creditRefillContext}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
assert.equal((await creditRefillContext('account','live',0)).amountCents,7500);
assert(paths.some(p=>p.includes('mode=eq.live'))&&paths.length===2);
paths=[];await creditRefillContext('account','test',0);
assert.equal(paths.length,1);assert(paths[0].includes('mode=eq.test'));
failUsage=true;assert.equal((await creditRefillContext('account','live',0)).amountCents,7500);
failHistory=true;assert.equal((await creditRefillContext('account','live',0)).amountCents,1000);
delete globalThis.__refillContext;
console.log('PASS refill context: paid manual history, tenant and mode boundaries, bounded usage, and independent lookup fallback.');
