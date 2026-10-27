import assert from 'node:assert/strict';
import {trainOutcomeRanker,rankerAuc,rankerProbability} from '../lib/outcome-ranker.ts';
const start=Date.parse('2026-01-01T00:00:00Z'),asOf='2026-05-01T00:00:00Z';
const rows=Array.from({length:1200},(_,i)=>({property:`property-${i}`,account:`account-${i%6}`,
 observedAt:new Date(start+i*3600000-1000).toISOString(),exposedAt:new Date(start+i*3600000).toISOString(),
 features:[i%2,...Array(11).fill(0)],baseline:0.5,interest:i%2,contract:null,closing:null}));
const began=performance.now(),result=trainOutcomeRanker(rows,asOf);
assert.equal(result.status,'qualified');assert.equal(result.model.objective,'interest');assert(result.metrics.auc>0.99);
assert(result.metrics.train<900,'Training windows ending after holdout begins are purged');
assert(result.metrics.brier<result.metrics.baselineBrier*0.95);
assert(rankerProbability(result.model,[1,...Array(11).fill(0)])>rankerProbability(result.model,Array(12).fill(0)));
assert.equal(rankerAuc([{score:1,label:1},{score:1,label:0}]),0.5);
assert.equal(trainOutcomeRanker(rows.map(r=>({...r,baseline:null})),asOf).status,'collecting','Retrospective baselines never establish improvement');
assert.equal(trainOutcomeRanker(rows.map(r=>({...r,interest:0})),asOf).status,'collecting','A sea of negatives does not become a model');
assert.equal(trainOutcomeRanker(rows.map(r=>({...r,features:Array(12).fill(0)})),asOf).status,'rejected','No predictive signal keeps baseline ranking');
assert.equal(trainOutcomeRanker(rows.map(r=>({...r,baseline:r.interest})),asOf).status,'rejected','Cannot promote a model that fails to beat the existing ordering');
assert.equal(trainOutcomeRanker(rows.map(r=>({...r,account:'one'})),asOf).status,'collecting','An account cannot overwhelm peers');
assert.equal(trainOutcomeRanker([...rows,...rows.map(r=>({...r,account:'duplicate'}))],asOf).metrics.samples,1200,'Cross-account property duplicates cannot leak into holdout');
assert.equal(trainOutcomeRanker(rows.map(r=>({...r,observedAt:'2026-06-01T00:00:00Z'})),asOf).metrics.samples,0,'Post-outcome features are rejected');
assert.equal(trainOutcomeRanker(rows,'2026-01-02T00:00:00Z').status,'collecting','Future and immature observations cannot qualify');
assert.equal(trainOutcomeRanker(rows.map(r=>({...r,contract:r.interest,closing:r.interest})),asOf).model.objective,'interest','Deal targets wait for enough history after purging overlapping windows');
const stretched=rows.map((r,i)=>({...r,exposedAt:new Date(start+i*7200000).toISOString(),contract:r.interest,closing:r.interest}));
assert.equal(trainOutcomeRanker(stretched,'2026-06-01T00:00:00Z').model.objective,'contract','Prefers verified contracts once their complete windows qualify');
assert.throws(()=>trainOutcomeRanker([{...rows[0],features:[NaN]}],asOf),/Invalid ranker dataset/);
assert.throws(()=>trainOutcomeRanker(Array(5001).fill(rows[0]),asOf),/Invalid ranker dataset/);
assert.throws(()=>rankerProbability(result.model,Array(12).fill(Infinity)),/Invalid ranker vector/);
console.log(`Outcome ranker: chronological validation, property deduplication, account caps, baseline comparisons and CPU-only fitting passed (${Math.round(performance.now()-began)}ms, synthetic fixtures).`);
