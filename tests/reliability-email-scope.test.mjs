import assert from 'node:assert/strict';
import {reliabilityEmailContent} from '../lib/reliability-alerts-service.ts';
import {reliabilityPriority} from '../lib/reliability-priority.ts';

const now=Date.parse('2026-11-16T22:26:00Z'),at=new Date(now).toISOString();
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const claim={id:id(1),incidentId:id(2),event:'detected',openedAt:'2026-11-13T19:00:00Z',reasons:['workflows'],issueCount:825,severity:'critical'};
const report={fresh:true,status:'degraded',components:{worker:{status:'ok',checkedAt:at},maintenance:{status:'ok',checkedAt:at}},snapshot:{checkedAt:at,issueCount:826,
 issues:[{kind:'call_receipt',resourceId:id(3),accountId:id(4),since:'2026-10-27T19:00:00Z'}],
 texts:{accepted:7,delivered:4,review:1},contracts:{created:1,completed:0,review:1},
 accountProgress:{checkedAt:at,affectedAccounts:171,stalledAccounts:3,pendingAccounts:168,expiredConfigurations:0,unexpectedPauses:0,samples:[{accountId:id(4),reason:'pending_work',since:'2026-10-27T19:00:00Z',lastCompletedAt:at,availableCents:100}]}}};
const render=(value=report,event='detected')=>reliabilityEmailContent({...claim,event},value,now);
const healthyAccounts=render();
assert.equal(reliabilityPriority(report,now),'critical','The existing account severity is preserved');
assert.equal(healthyAccounts.subject,'iCash X · Critical priority — Account/workflow issues');
assert.match(healthyAccounts.text,/Both background checks are responding/);
assert.match(healthyAccounts.text,/Incident record when this alert was prepared: workflow recovery; 825 monitor flags/,'The claimed incident count is distinct from the subsequent snapshot');
assert.match(healthyAccounts.text,/Current aggregate monitor flags: 826/,'Current monitoring is separate from the claimed event');
assert.match(healthyAccounts.text,/Accounts needing attention: 171/);
assert.match(healthyAccounts.text,/no recent completed task recorded: 3/);
assert.match(healthyAccounts.text,/earlier work awaiting confirmation: 168/);
assert.match(healthyAccounts.text,/Priority describes urgency, not the extent of an outage/);
assert.match(healthyAccounts.text,/Whole-platform outage: not established/);
assert.match(healthyAccounts.text,/Earlier activity does not prove work is healthy now/);
assert.match(healthyAccounts.text,/Evidence checked: Nov 16, 2026, 4:26 PM Central/);
assert.match(healthyAccounts.text,/Next action: Immediate investigation required/);
assert(!JSON.stringify(healthyAccounts).includes(id(3)));assert(!JSON.stringify(healthyAccounts).includes(id(4)));

for(const states of [['degraded','ok'],['ok','degraded'],['unavailable','unavailable']]){
 const value={...report,components:{worker:{status:states[0],checkedAt:at},maintenance:{status:states[1],checkedAt:at}}};
 const email=render(value);
 assert.match(email.subject,/Background service checks failing/);
 assert.match(email.text,/Whole-platform outage: not established/);
 assert.match(email.text,/missing heartbeat does not by itself prove the process stopped/);
 if(states[1]==='ok')assert.match(email.text,/What works: maintenance and recovery checks are responding/);
 if(states.every(s=>s==='unavailable'))assert.match(email.text,/No healthy background check was verified/);
}

const clean={...report,status:'ok',snapshot:{...report.snapshot,issueCount:0,issues:[],accountProgress:{...report.snapshot.accountProgress,affectedAccounts:0,stalledAccounts:0,pendingAccounts:0,samples:[]}}};
for(const value of [null,{bad:true},{...report,fresh:false},{...report,snapshot:null},
 {...report,snapshot:{...report.snapshot,checkedAt:'2020-01-01T00:00:00Z'}},
 {...report,snapshot:{...report.snapshot,checkedAt:new Date(now+60000).toISOString()}}]){
 const email=render(value);
 assert.match(email.subject,/Current impact unverified/);
 assert.match(email.text,/Scope: unknown/);
 assert.match(email.text,/What works: unverified/);
 assert.doesNotMatch(email.text,/checks are responding|Core background checks are healthy/);
}
for(const checkedAt of [null,'2020-01-01T00:00:00Z',new Date(now+60000).toISOString()]){
 const email=render({...clean,components:{...clean.components,worker:{status:'ok',checkedAt}}});
 assert.match(email.subject,/Current impact unverified/);
 assert.doesNotMatch(email.text,/background worker checks are responding|Both background checks are responding/);
}
for(const checkedAt of ['2020-01-01T00:00:00Z',new Date(now+60000).toISOString()]){
 const staleAccount=render({...report,snapshot:{...report.snapshot,accountProgress:{...report.snapshot.accountProgress,checkedAt}}});
 assert.match(staleAccount.text,/Account impact and interrupted work: unverified/);assert.doesNotMatch(staleAccount.text,/Accounts needing attention: 171/);
}
for(const value of [{...clean,status:'degraded'},{...clean,components:{...clean.components,worker:{status:'standby',checkedAt:at}}}])assert.match(render(value).subject,/Current impact unverified/);
for(const progress of [undefined,{...clean.snapshot.accountProgress,pendingAccounts:1},{...clean.snapshot.accountProgress,samples:report.snapshot.accountProgress.samples}]){
 const value={...clean,snapshot:{...clean.snapshot,accountProgress:progress}};
 assert.match(render(value).subject,/Current impact unverified/,'Absent or contradictory account evidence cannot establish clear current health');
 assert.match(render(value,'recovered').subject,/current health needs verification/);
 assert.match(render(value,'recovered').text,/Account impact and interrupted work: unverified/);
}
const emptyLearningComponent={lastAttemptAt:at,lastSuccessAt:at,lastErrorAt:null,lastErrorCode:null};
for(const fields of [
 {issues:report.snapshot.issues},
 {incomingTexts:{checkedAt:at,fresh:true,warningCount:1,lines:[]}},
 {researchQuota:{checkedAt:at,fresh:true,status:'unavailable',warningCount:1}},
 {learning:{checkedAt:at,fresh:true,status:'degraded',warningCount:1,queue:{accounts:1,due:0,failed:0,stale:0,neverRefreshed:0,oldestDueAt:null,oldestSuccessAt:at},refresh:emptyLearningComponent,conversion:{...emptyLearningComponent,updatedAt:at}}},
]){
 const value={...clean,snapshot:{...clean.snapshot,...fields}};
 assert.match(render(value).subject,/Current impact unverified/);
 assert.match(render(value).text,/conflicting workflow counts/);
 assert.match(render(value,'recovered').subject,/current health needs verification/);
}
const pendingOnly=render({...report,snapshot:{...report.snapshot,accountProgress:{...report.snapshot.accountProgress,stalledAccounts:0,pendingAccounts:171}}});
assert.match(pendingOnly.subject,/Critical priority — Account\/workflow issues/);
assert.match(pendingOnly.text,/no recent completed task recorded: 0/);
assert.match(pendingOnly.text,/earlier work awaiting confirmation: 171/);
assert.match(pendingOnly.text,/Pending receipts and missing completion records are not confirmed failed sends/);

const historicalAlert=render(clean);
assert.match(historicalAlert.subject,/Critical priority — Current checks clear/);
assert.match(historicalAlert.text,/Incident record when this alert was prepared: workflow recovery; 825 monitor flags/);
assert.match(historicalAlert.text,/verified clear recovery window has not yet been recorded/);
const recovered=render(clean,'recovered');
assert.equal(recovered.subject,'iCash X · Recovery window recorded');
assert.match(recovered.text,/The latest checks are also clear/);
assert.match(recovered.text,/does not confirm every message was delivered/);
assert.match(recovered.text,/historical alerts may still have unresolved provider receipts or blocked work/);
for(const value of [null,report,{...clean,status:'degraded'},{...clean,components:{...clean.components,worker:{status:'degraded',checkedAt:at}}}]){
 const email=render(value,'recovered');
 assert.match(email.subject,/current health needs verification/);
 assert.match(email.text,/recorded recovery window does not override newer or unavailable observations/);
 assert.doesNotMatch(email.text,/The latest checks are also clear/);
}
console.log('PASS email scope separates priority, account receipts, failing components, unknown evidence and historical recovery without exposing account details.');
