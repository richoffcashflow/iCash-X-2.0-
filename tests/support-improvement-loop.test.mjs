import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {supportQualityReport} from '../lib/support-quality.ts';
import {supportImprovementReport} from '../lib/support-improvement.ts';
import {supportRepeatedFailedSteps,supportDisputeLanguage,supportPaymentAccessConcern} from '../lib/support-learning-signals.ts';
import {replyToSupport} from '../lib/support-conversation.ts';
import {supportManagementReview} from '../lib/support-management-review.ts';
const now=new Date('2026-11-08T12:00:00Z');
const msg=(role,content,n)=>({role,content,created_at:new Date(now.getTime()-(30-n)*60000).toISOString()});
const fixture=(id,messages,extra={})=>({id,kind:'account',subject:'Fictional help',status:'open',created_at:'2026-11-01T12:00:00Z',updated_at:messages.at(-1)?.created_at??now.toISOString(),messages,...extra});
const history=[msg('user','My custom voice playback failed.',0),msg('assistant','Choose the correct output device.',1),msg('user','That did not work.',2),msg('assistant','Check the browser volume.',3),msg('user','I already tried that and still nothing.',4)];
assert.equal(supportRepeatedFailedSteps(history),true);
assert.equal(supportRepeatedFailedSteps(history.slice(0,3)),false,'One failed attempt is not two failures');
assert.equal(supportRepeatedFailedSteps([...history.slice(0,4),msg('user','Where is the course?',5)]),false);
assert.equal(supportRepeatedFailedSteps([...history.slice(0,3),msg('operator','I checked the audio issue.',4),msg('user','That did not work.',5)]),false,'Operator intervention starts a fresh sequence');
assert.equal(supportRepeatedFailedSteps([...history.slice(0,3),msg('user','My access code is missing.',4),msg('assistant','Check the email address.',5),msg('user','That did not work.',6)]),false,'Do not combine different issues');
assert.equal(supportRepeatedFailedSteps([...history.slice(0,3),msg('assistant','Another check.',4),msg('user','That worked.',5),msg('assistant','Glad it worked.',6),msg('user','That did not work.',7)]),false,'A successful result resets the sequence');
for(const q of ['What is a chargeback?','How can I avoid a buyer deposit dispute?','I will not file a chargeback','I don’t want to file a bank dispute'])assert.equal(supportDisputeLanguage(q),false,q);
assert.equal(supportDisputeLanguage('I will file a chargeback if this is not resolved'),true);
assert.equal(supportPaymentAccessConcern('What if I am charged twice?'),false);
assert.equal(supportPaymentAccessConcern('My account is still locked'),true);
const corrected=fixture('corrected',[msg('user','Why does my page not load?',0),msg('assistant','Everything is working.',1),msg('operator','I found a display problem. The earlier reply was incorrect.',2)]);
const paid=fixture('paid',[msg('user','I paid but my account is locked. I will file a chargeback.',1)]);
const thanks=fixture('thanks',[msg('user','My code is missing.',0),msg('assistant','We will review the saved details.',1),msg('user','Thanks',2)],{status:'resolved'});
const fixed=fixture('fixed',[msg('user','My code is missing.',0),msg('assistant','Check the saved email.',1),msg('user','That worked. I can sign in now.',2)],{status:'resolved'});
const closed=fixture('closed',history,{status:'resolved'});
const stuck=fixture('stuck',history);
const sample=[corrected,paid,thanks,fixed,closed,stuck];
const report=supportQualityReport(sample,now),learning=report.improvement;
assert.equal(learning.metrics.reviewed,6);assert.equal(learning.metrics.customerConfirmed,1);
assert.equal(learning.metrics.closedWithoutConfirmation,2);assert.equal(learning.metrics.failedSteps,2);
assert.equal(learning.metrics.operatorCorrections,1);assert.equal(learning.metrics.paymentAccess,1);assert.equal(learning.metrics.disputeLanguage,1);
assert.equal(learning.candidates[0].id,'paid');assert.equal(learning.candidates[0].priority,'urgent');
assert(learning.candidates.find(c=>c.id==='closed').codes.includes('unverified_closure'));
assert(learning.candidates.find(c=>c.id==='corrected').codes.includes('operator_correction'),'Operator teaching survives superseded content flags');
assert(!report.cases.some(c=>c.id==='corrected'),'Existing current-case flags still respect operator correction');
assert(!JSON.stringify(learning).includes('Everything is working'),'Learning output contains no raw conversation text');
const duplicate=supportQualityReport([...sample,paid],now).improvement;
assert.equal(duplicate.metrics.reviewed,6);assert.equal(duplicate.metrics.paymentAccess,1,'Each conversation counts once per snapshot');
const original=learning.candidates.find(c=>c.id==='stuck').evidenceKey;
const triaged=supportQualityReport([fixture('stuck',history,{status:'escalated',updated_at:now.toISOString()})],now).improvement;
assert.equal(triaged.candidates[0].evidenceKey,original,'Status updates do not become new learning evidence');
const changed=supportQualityReport([fixture('stuck',[...history,msg('user','Still nothing.',6)])],now).improvement;
assert.notEqual(changed.candidates[0].evidenceKey,original);
assert.equal(supportQualityReport(sample,now,true).improvement.limited,true);
assert.equal(supportImprovementReport(Array.from({length:201},(_,n)=>fixture('case-'+n,[])),[],now).metrics.reviewed,200);
assert.equal(supportImprovementReport(Array.from({length:201},(_,n)=>fixture('case-'+n,[])),[],now).limited,true);
assert.equal(supportImprovementReport([fixture('long',Array.from({length:81},(_,n)=>msg('user','Saved detail',n-100)))],[],now).limited,true);
assert.equal(supportImprovementReport([fixture('future',[{...msg('user','My account is locked',0),created_at:'2027-01-01T00:00:00Z'}])],[],now).limited,true);

// Actual reply pipeline: the second failed step stops cycling and requests the
// existing atomic management-review finisher, without external AI or account work.
const env={...process.env};let external=0;
try{
 process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='fixture';process.env.ICASH_SUPPORT_AI_MODEL='fixture';
 for(const kind of ['account','access']){
  const result=await replyToSupport({kind,messages:history,evidence:[]},async()=>{external++;throw Error('External model forbidden');});
  assert.equal(result.managementReview,true,kind);assert.equal(result.status,'open');assert.match(result.reply,/don’t need to repeat/);assert.doesNotMatch(result.reply,/Which device|within .*hours|we fixed/i);
 }
 assert.equal(external,0);
}finally{process.env=env;}
const routine=supportManagementReview({kind:'account',messages:history},{reply:'A direct product answer.',status:'open',ai:false,routineGuidance:true});assert.equal(routine.managementReview,undefined);
const dir=mkdtempSync(join(tmpdir(),'support-improvement-'));
try{
 const path=join(dir,'private.json');writeFileSync(path,JSON.stringify({conversations:sample,limited:false}));
 const run=spawnSync(process.execPath,['--experimental-strip-types','scripts/review-support-improvement.mjs',path,now.toISOString()],{encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);assert.equal(JSON.parse(run.stdout).metrics.customerConfirmed,1);assert(!run.stdout.includes('I paid but'));
 writeFileSync(path,JSON.stringify({conversations:sample}));const invalid=spawnSync(process.execPath,['--experimental-strip-types','scripts/review-support-improvement.mjs',path,now.toISOString()],{encoding:'utf8'});assert.notEqual(invalid.status,0,'An unknown coverage bound must fail rather than appear complete');
}finally{rmSync(dir,{recursive:true,force:true});}
console.log('PASS support improvement loop: bounded private signals, stable deduplication, operator corrections, honest outcomes, risk priority, topic resets and real no-model handoffs.');
