import {z} from 'zod';

export const targetingLearningVersion='seller-targeting-learning-v1';
const count=z.number().int().nonnegative();
const arm=z.object({strategy:z.string(),attempts:count,matureAttempts:count,interested:count,optedOut:count,
 contractTrials:count,contracts:count,closingTrials:count,closings:count,costCents:count,providerCostMicros:count,costsComplete:z.boolean()}).strict()
 .refine(s=>s.matureAttempts<=s.attempts&&s.interested<=s.matureAttempts&&s.optedOut<=s.attempts&&s.contracts<=s.contractTrials&&s.closings<=s.closingTrials);
export const targetingLearningContext=z.object({accountId:z.uuid(),zip:z.string().regex(/^\d{5}$/),pageSize:z.number().int().min(1).max(100),queryPolicy:z.object({version:z.literal('research-efficiency-v2'),exclusionListId:z.string().min(1)}).strict()}).strict();
const evidence=z.object({version:z.literal(targetingLearningVersion),context:targetingLearningContext,startedAt:z.iso.datetime({offset:true}),checkedAt:z.iso.datetime({offset:true}),baseline:arm,candidate:arm}).strict();
type Arm=z.infer<typeof arm>;
export type TargetingLearningDecision={status:'collecting'|'invalid'|'costs_incomplete'|'opt_out_hold'|'baseline_preferred'|'candidate_supported';objective:'interest'|'contracts'|'closings';value:number;hold:boolean};
// Two-sided 95% Wilson bounds. A positive lower bound alone is not superiority.
function bound(wins:number,trials:number,upper:boolean){
 if(trials<=0)return upper?1:0;
 const p=wins/trials,z=1.96,z2=z*z;
 return Math.max(0,Math.min(1,(p+z2/(2*trials)+(upper?1:-1)*z*Math.sqrt(p*(1-p)/trials+z2/(4*trials*trials)))/(1+z2/trials)));
}
export function targetingLearningDecision(raw:unknown,context:unknown,strategy:string,now=Date.now()):TargetingLearningDecision{
 const result=(status:TargetingLearningDecision['status'],objective:TargetingLearningDecision['objective']='interest',value=0):TargetingLearningDecision=>({status,objective,value,hold:status==='opt_out_hold'});
 const parsed=evidence.safeParse(raw),scope=targetingLearningContext.safeParse(context);
 if(!parsed.success||!scope.success)return result('invalid');
 const e=parsed.data,c=e.context;
 if(c.accountId!==scope.data.accountId||c.zip!==scope.data.zip||c.pageSize!==scope.data.pageSize||c.queryPolicy.version!==scope.data.queryPolicy.version||c.queryPolicy.exclusionListId!==scope.data.queryPolicy.exclusionListId
  ||e.baseline.strategy!=='baseline'||e.candidate.strategy!==strategy||Date.parse(e.startedAt)>Date.parse(e.checkedAt)||Date.parse(e.checkedAt)>now||Date.parse(e.checkedAt)<=now-5*60000)return result('invalid');
 const a=e.candidate,b=e.baseline;
 if(a.attempts>=100&&a.optedOut/a.attempts>0.05)return result('opt_out_hold');
 if(!a.costsComplete||!b.costsComplete||a.costCents<=0||b.costCents<=0||a.providerCostMicros<=0||b.providerCostMicros<=0)return result('costs_incomplete');
 let objective:TargetingLearningDecision['objective']='interest';
 if(a.closingTrials>=100&&b.closingTrials>=100)objective='closings';
 else if(a.contractTrials>=100&&b.contractTrials>=100)objective='contracts';
 const trials=(s:Arm)=>objective==='closings'?s.closingTrials:objective==='contracts'?s.contractTrials:s.matureAttempts;
 const wins=(s:Arm)=>objective==='closings'?s.closings:objective==='contracts'?s.contracts:s.interested;
 if(trials(a)<100||trials(b)<100||wins(a)<(objective==='interest'?10:5)||a.attempts<100||b.attempts<100)return result('collecting',objective);
 // A high-opt-out control cannot justify a new winner, and the candidate cannot
 // trade more than one percentage point of recipient harm for apparent yield.
 if(b.optedOut/b.attempts>0.05||a.optedOut/a.attempts>b.optedOut/b.attempts+0.01)return result('baseline_preferred',objective);
 const low=bound(wins(a),trials(a),false)*trials(a),high=bound(wins(b),trials(b),true)*trials(b);
 const customer=low/a.costCents,provider=low/a.providerCostMicros;
 return customer>1.05*high/b.costCents&&provider>1.05*high/b.providerCostMicros?result('candidate_supported',objective,customer):result('baseline_preferred',objective);
}
