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
assert.equal(healthyAccounts.subject,'iCash X · Critical priority update — Account/workflow issues');
assert.match(healthyAccounts.text,/Accounts needing attention: 171/);
assert.match(healthyAccounts.text,/No recent completed task recorded: 3/);
assert.match(healthyAccounts.text,/Earlier work awaiting confirmation: 168/);
assert.match(healthyAccounts.text,/Evidence checked: Nov 16, 2026, 4:26 PM Central/);
assert.match(healthyAccounts.text,/^Next action: Investigate now\./);
assert(!JSON.stringify(healthyAccounts).includes(id(3)));assert(!JSON.stringify(healthyAccounts).includes(id(4)));

for(const states of [['degraded','ok'],['ok','degraded'],['unavailable','unavailable']]){
 const value={...report,components:{worker:{status:states[0],checkedAt:at},maintenance:{status:states[1],checkedAt:at}}};
 const email=render(value);
 assert.match(email.subject,/Background service checks failing/);
}

const clean={...report,status:'ok',snapshot:{...report.snapshot,issueCount:0,issues:[],accountProgress:{...report.snapshot.accountProgress,affectedAccounts:0,stalledAccounts:0,pendingAccounts:0,samples:[]}}};
for(const value of [null,{bad:true},{...report,fresh:false},{...report,snapshot:null},
 {...report,snapshot:{...report.snapshot,checkedAt:'2020-01-01T00:00:00Z'}},
 {...report,snapshot:{...report.snapshot,checkedAt:new Date(now+60000).toISOString()}}]){
 const email=render(value);
 assert.match(email.subject,/Current impact unverified|Monitoring snapshot not current/);
 assert.doesNotMatch(email.text,/checks are responding|Core background checks are healthy/);
}
for(const checkedAt of [null,'2020-01-01T00:00:00Z',new Date(now+60000).toISOString()]){
 const email=render({...clean,components:{...clean.components,worker:{status:'ok',checkedAt}}});
 assert.match(email.subject,/Current impact unverified|Monitoring snapshot not current/);
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
assert.match(pendingOnly.subject,/Critical priority update — Account\/workflow issues/);
assert.match(pendingOnly.text,/No recent completed task recorded: 0/);
assert.match(pendingOnly.text,/Earlier work awaiting confirmation: 171/);

const historicalAlert=render(clean);
assert.match(historicalAlert.subject,/Critical priority update — Current checks clear/);
assert.match(historicalAlert.text,/No clear recovery window recorded yet/);
for(const value of [historicalAlert.text,historicalAlert.html]){
 assert.doesNotMatch(value,/Investigate now/);
 assert.match(value,/Continue monitoring/);
}
const recovered=render(clean,'recovered');
assert.equal(recovered.subject,'iCash X · Recovery window recorded');
assert.match(recovered.text,/The latest checks are also clear/);
for(const value of [null,report,{...clean,status:'degraded'},{...clean,components:{...clean.components,worker:{status:'degraded',checkedAt:at}}}]){
 const email=render(value,'recovered');
 assert.match(email.subject,/current health needs verification/);
 assert.match(email.text,/newer or unavailable checks do not verify current health/);
 assert.doesNotMatch(email.text,/The latest checks are also clear/);
}
const overlapReport={...report,snapshot:{...report.snapshot,accountProgress:{...report.snapshot.accountProgress,affectedAccounts:183,pendingAccounts:183,stalledAccounts:131,stalledPendingAccounts:131}}};
const overlapEmail=render(overlapReport);
assert.match(overlapEmail.text,/Accounts needing attention: 183.*131 are in both groups/);
const remainder=render({...overlapReport,snapshot:{...overlapReport.snapshot,accountProgress:{...overlapReport.snapshot.accountProgress,
 affectedAccounts:190,expiredConfigurations:2,unexpectedPauses:1}}});
for(const value of [remainder.text,remainder.html]){
 assert.match(value,/Expired configurations: 2; unexpected pauses: 1/);
 assert.match(value,/Other account issues \(see dashboard\): 4/);
}
assert.doesNotMatch(overlapEmail.text,/Other account issues/);
for(const stalledPendingAccounts of [0,132,184]){
 const invalid={...overlapReport,snapshot:{...overlapReport.snapshot,accountProgress:{...overlapReport.snapshot.accountProgress,stalledPendingAccounts}}};
 assert.match(render(invalid).text,/Account impact and interrupted work: unverified/);
}
const stale=(issueCount,maintenance=report.components.maintenance)=>render({...overlapReport,fresh:false,components:{maintenance,worker:{status:'degraded',checkedAt:at}},
 snapshot:{...overlapReport.snapshot,checkedAt:new Date(now-180000).toISOString(),issueCount}});
assert.deepEqual(stale(1038),stale(1041),'Stale count jitter never changes owner email copy');
assert.match(stale(1041).subject,/Critical priority update — Monitoring snapshot not current/);
assert.match(stale(1041).text,/background worker: degraded/);
assert.match(stale(1041).text,/Last monitor snapshot:/);
assert.match(stale(1041).text,/Current impact: unverified/);
assert.doesNotMatch(stale(1041).text,/1041|825|Accounts needing attention/);
assert.ok(stale(1041).text.length<750);
console.log('PASS email scope separates priority, account receipts, failing components, unknown evidence and historical recovery without exposing account details.');
for(const email of [stale(1041),overlapEmail,recovered]){
 assert.equal((email.html.match(/<h1 /g)??[]).length,1);
 assert.match(email.html,/<html lang="en" dir="ltr">/);
 assert.match(email.html,/<meta name="viewport" content="width=device-width, initial-scale=1">/);
 assert.match(email.html,/max-width:560px/);
 assert.match(email.html,/<h2 [^>]*>Impact<\/h2>[\s\S]*<h2 [^>]*>Next action<\/h2>[\s\S]*Open the iCash X workflow dashboard[\s\S]*Check details[\s\S]*Incident reference/);
 assert.ok(email.html.includes(email.text.split('\n')[0].replace(/^Next action: /,'')));
 assert.doesNotMatch(email.html,/http:\/\/|<script|<img|\bid="|font-size:1[0123]px/);
}
assert.match(stale(1041).html,/Current impact: unverified/);
assert.doesNotMatch(stale(1041).html,/1041|825|Accounts needing attention/);
assert.match(overlapEmail.html,/131 are in both groups/);
assert.match(recovered.html,/The latest checks are also clear/);
const mixed=stale(1041,{status:'degraded',checkedAt:new Date(now-180000).toISOString()});
for(const value of [mixed.text,mixed.html]){
 assert.match(value,/Current impact: unverified.*Failing checks: background worker\./);
 assert.match(value,/Investigate now\. Check background worker and restore monitoring/);
 assert.match(value,/maintenance: unverified/);
 assert.doesNotMatch(value,/Failing checks: background worker and maintenance|maintenance: degraded/);
}
const both=stale(1041,{status:'degraded',checkedAt:at});
assert.match(both.html,/Failing checks: background worker and maintenance\./);
