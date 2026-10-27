/** Small CPU-only model. Features contain property measurements, never contact data.
 * A chronological, property-disjoint holdout gates use; it does not prove deal lift. */
import {z} from 'zod';

export const rankerVersion='property-logistic-v1' as const;
export const featureCount=12;
export const objectives=['closing','contract','interest'] as const;
export type Objective=typeof objectives[number];
const label=z.union([z.literal(0),z.literal(1)]).nullable();
const sampleSchema=z.object({
 property:z.string().min(1).max(64),account:z.string().min(1).max(64),
 observedAt:z.iso.datetime({offset:true}),exposedAt:z.iso.datetime({offset:true}),
 features:z.array(z.number().min(0).max(1)).length(featureCount),
 baseline:z.number().finite().nullable(),interest:label,contract:label,closing:label,
});
export type RankerSample=z.infer<typeof sampleSchema>;
export type RankerModel={version:typeof rankerVersion;objective:Objective;weights:number[];intercept:number;rate:number};
export type RankerResult={status:'collecting'|'rejected'|'qualified';reason:string;model:RankerModel|null;metrics:Record<string,number|string>};
const windows={interest:3,contract:30,closing:60} as const;
const sigmoid=(n:number)=>1/(1+Math.exp(-Math.max(-30,Math.min(30,n))));
export function rankerProbability(model:RankerModel,features:number[]){
 if(model.version!==rankerVersion||model.weights.length!==featureCount||features.length!==featureCount
  ||!Number.isFinite(model.intercept)||model.weights.some(n=>!Number.isFinite(n))||features.some(n=>!Number.isFinite(n)||n<0||n>1))throw Error('Invalid ranker vector');
 return sigmoid(model.intercept+features.reduce((sum,n,i)=>sum+n*model.weights[i],0));
}
function fit(rows:RankerSample[],objective:Objective):RankerModel{
 const rate=rows.reduce((n,r)=>n+Number(r[objective]),0)/rows.length;
 const model:RankerModel={version:rankerVersion,objective,weights:Array(featureCount).fill(0),intercept:Math.log(rate/(1-rate)),rate};
 for(let iteration=0;iteration<120;iteration++){
  const gradient=Array(featureCount).fill(0);let bias=0;
  for(const row of rows){const error=rankerProbability(model,row.features)-Number(row[objective]);bias+=error;for(let j=0;j<featureCount;j++)gradient[j]+=error*row.features[j];}
  model.intercept-=0.5*bias/rows.length;
  for(let j=0;j<featureCount;j++)model.weights[j]-=0.5*(gradient[j]/rows.length+0.002*model.weights[j]);
 }
 return model;
}
/** Tie-aware AUROC; sorted ranks keep validation O(n log n). */
export function rankerAuc(values:{score:number;label:number}[]){
 const sorted=[...values].sort((a,b)=>a.score-b.score);let positives=0,rankSum=0;
 for(let i=0;i<sorted.length;){let end=i+1;while(end<sorted.length&&sorted[end].score===sorted[i].score)end++;
  const rank=(i+1+end)/2;for(let j=i;j<end;j++)if(sorted[j].label===1){positives++;rankSum+=rank;}i=end;
 }
 return positives&&positives<values.length?(rankSum-positives*(positives+1)/2)/(positives*(values.length-positives)):0.5;
}
export function trainOutcomeRanker(input:unknown,asOf=new Date().toISOString()):RankerResult{
 const parsed=z.array(sampleSchema).max(5000).safeParse(input),now=Date.parse(asOf);
 if(!parsed.success||!Number.isFinite(now))throw Error('Invalid ranker dataset');
 const counts=new Map<string,number>(),properties=new Set<string>();
 // Oldest observation owns a property across accounts and across both partitions.
 const rows=parsed.data.sort((a,b)=>Date.parse(a.exposedAt)-Date.parse(b.exposedAt)||a.property.localeCompare(b.property)).filter(r=>{
  if(Date.parse(r.observedAt)>Date.parse(r.exposedAt)||Date.parse(r.exposedAt)>now||properties.has(r.property)||(counts.get(r.account)??0)>=200)return false;
  properties.add(r.property);counts.set(r.account,(counts.get(r.account)??0)+1);return true;
 });
 let last:RankerResult={status:'collecting',reason:'More mature outcomes are needed',model:null,metrics:{samples:rows.length}};
 for(const objective of objectives){
  const windowMs=windows[objective]*86400000;
  const mature=rows.filter(r=>r[objective]!==null&&Date.parse(r.exposedAt)+windowMs<=now);
  // Validation requires a baseline recorded BEFORE outreach. Backfilled scores do not qualify.
  const prospective=mature.filter(r=>r.baseline!==null),test=prospective.slice(-Math.max(100,Math.floor(prospective.length*0.25)));
  const cut=test.length?Date.parse(test[0].exposedAt):0;
  const train=mature.filter(r=>Date.parse(r.exposedAt)+windowMs<cut);
  const positives=(data:RankerSample[])=>data.reduce((n,r)=>n+Number(r[objective]),0);
  const trainPositive=positives(train),testPositive=positives(test);
  const trainAccounts=new Set(train.map(r=>r.account)).size,validationAccounts=new Set(test.map(r=>r.account)).size;
  const metrics={samples:rows.length,objective,mature:mature.length,train:train.length,validation:test.length,trainPositive,validationPositive:testPositive,trainAccounts,validationAccounts};
  if(train.length<200||test.length<100||trainPositive<20||train.length-trainPositive<20||testPositive<10||test.length-testPositive<10
   ||trainAccounts<3||validationAccounts<3){
   if(last.status==='collecting')last={status:'collecting',reason:'Waiting for mature positives and a later comparison cohort',model:null,metrics};continue;
  }
  const model=fit(train,objective),predictions=test.map(r=>({score:rankerProbability(model,r.features),label:Number(r[objective])}));
  const brier=predictions.reduce((sum,r)=>sum+(r.score-r.label)**2,0)/test.length;
  const baselineBrier=predictions.reduce((sum,r)=>sum+(model.rate-r.label)**2,0)/test.length;
  const auc=rankerAuc(predictions),baselineAuc=rankerAuc(test.map(r=>({score:Number(r.baseline),label:Number(r[objective])})));
  const qualified=brier<baselineBrier*0.95&&auc>=0.6&&auc>=baselineAuc+0.03;
  const result:RankerResult={status:qualified?'qualified':'rejected',reason:qualified?'Passed chronological prediction checks; online lift remains unproven':'Did not improve both calibration and baseline ranking',model:qualified?model:null,metrics:{...metrics,brier,baselineBrier,auc,baselineAuc}};
  if(qualified)return result;
  // Do not fall back to an easier proxy when a deal-level target has enough evidence but fails.
  return result;
 }
 return last;
}
