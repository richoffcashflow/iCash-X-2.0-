import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {prepareSupportRefundEvidence,refundDeliverySummary,savedRefundCase} from '../lib/support-refund-evidence.ts';
import {replyToSupport} from '../lib/support-conversation.ts';
import {supportReplyEvidence} from '../lib/support-reply-style.ts';
import {refundEvidenceNeeded} from '../lib/support-closure.ts';
const accountId=randomUUID(),threadId=randomUUID(),requestId=randomUUID(),membership=randomUUID(),foreign=randomUUID();
const stamp='2026-10-20T12:00:00.000Z';
const checked=(key,detail,extra={})=>({key,source:'fixture',status:'ok',observedAt:stamp,detail,...extra});
const checks=[checked('subscription','Software subscription is active.',{softwareAccess:true}),checked('course','No playback recorded.',{course:{revision:1,state:'unrecorded',percent:null}}),checked('outreach','3 researched properties, 1 incoming seller lead; 2 texts sent, no replies.',{outreach:{screened:4,outboundProperties:3,inboundProperties:1,contactProperties:2,textsSent:2,textsDelivered:2,textReplies:0,callsStarted:1,callsBudgetHeld:0,progress:null}})];
const paths=[];let wrongAccount=false,outage=false,late=false,missing=false;
const db=async(path,method,body,signal)=>{
 paths.push(path);assert.equal(method,'GET');assert.equal(body,undefined);assert(signal instanceof AbortSignal);assert(path.includes('limit=6'));
 if(outage)throw Error('Unavailable');
 if(path.startsWith('icash_memberships?')){assert(path.includes(`account_id=eq.${accountId}&mode=eq.live`));return [{id:membership,account_id:wrongAccount?foreign:accountId,mode:'live'}];}
 if(path.startsWith('icash_funding_orders?')){assert(path.includes(`account_id=eq.${accountId}&mode=eq.live`));return [];}
 if(path.startsWith('icash_membership_invoices?')){assert(path.includes(`membership_id=in.(${membership})`));return [{membership_id:membership,stripe_invoice_id:'in_fixture',stripe_payment_id:'pi_fixture',amount_cents:5000,recorded_at:stamp}];}
 if(path.startsWith('icash_purchase_acceptances?')){assert(path.includes(`reference_id=in.(${membership})&mode=eq.live`));return missing?[]:[{kind:'membership',reference_id:membership,version:'original-v1',policy_version:'policy-v1',policy_text:'All sales are final, except where refunds are required by applicable law.',accepted_at:late?'2026-10-21T12:00:00.000Z':'2026-10-20T11:59:00.000Z'}];}
 assert(path.includes(`account_id=eq.${accountId}`));
 if(path.startsWith('icash_software_access_receipts?'))return [{recorded_at:stamp}];
 if(path.startsWith('icash_operation_spend?')){assert(path.includes('state=eq.settled'));return [{operation_key:'voice-fixture',charged_cents:25,settled_at:stamp}];}
 throw Error('Unexpected query '+path);
};
let evidence=await prepareSupportRefundEvidence(db,{accountId,threadId,requestId},checks,'live');
assert.equal(evidence.refundCase.policyAcceptanceRecorded,true);
assert(!supportReplyEvidence([{role:'user',content:'Where is the course?'}],[...checks,evidence]).some(e=>e.key==='refund_case'),'Private packet is excluded from model checks and unresolved status');
assert.equal(refundEvidenceNeeded([{role:'user',content:'refund me'},{role:'user',content:'Where is the course?'}]),false,'Do not regenerate refund evidence for a different topic');
assert.equal(savedRefundCase(evidence.refundCase,foreign),null);
assert.equal(savedRefundCase(evidence.refundCase,accountId,foreign),null);
assert.equal(savedRefundCase({version:9},accountId),null);
assert(savedRefundCase(evidence.refundCase,accountId,threadId));
assert(evidence.refundCase.sections.some(s=>s.lines.some(l=>l.includes('pi_fixture'))));
assert(evidence.refundCase.sections.some(s=>s.lines.some(l=>l.includes('not proof')||l.includes('do not prove'))));
assert(Buffer.byteLength(JSON.stringify([...checks,evidence]))<32000);
assert.match(refundDeliverySummary(checks),/3 researched properties, 1 incoming seller lead, course access, access to the AI software/);
assert.doesNotMatch(refundDeliverySummary(checks),/motivated|completed|watched|closed deal|guarantee|scam/i);
assert.equal(refundDeliverySummary([]),'');
assert.equal(refundDeliverySummary([checked('course','No viewing',{course:{revision:1,state:'unrecorded',percent:null}})]),'');
const user=content=>({role:'user',content}),assistant=content=>({role:'assistant',content});
const start=[user('I want a refund'),assistant('All sales are final; we do not offer refunds.')];
for(const angry of ['Give me my fucking money back','This is bullshit','Fuck you','You are a fucking scam give me a refund','Give me my f**king refund']){
 const messages=[...start,user(angry)];assert(refundEvidenceNeeded(messages));
 const answer=await replyToSupport({kind:'account',messages,evidence:[...checks,evidence],allowAI:false});
 assert.equal(answer.status,'closed',angry);assert.match(answer.reply,/final response/);assert.match(answer.reply,/accepted the all-sales-final policy/);assert.match(answer.reply,/3 researched properties/);assert.match(answer.reply,/reopen/);
}
const guest=await replyToSupport({kind:'access',messages:[...start,user('Fuck you')],evidence:[...checks,evidence],allowAI:false});
assert.equal(guest.status,'closed');assert.doesNotMatch(guest.reply,/accepted|researched|course access|AI software/,'Guest must not receive account facts even if context accidentally contains them');
for(const issue of ['My fucking bot is broken, refund me','Refund me you charged me twice','Fuck you cancel my subscription','Your damn sign in code never came','I want a refund under consumer rights','I never agreed to this policy refund me']){
 const answer=await replyToSupport({kind:'account',messages:[...start,user(issue)],evidence:[...checks,evidence],allowAI:false});assert.notEqual(answer.status,'closed',issue);
}
const unresolved=await replyToSupport({kind:'account',messages:[user('My bot never made calls'),...start,user('Fuck you')],evidence:[...checks,evidence],allowAI:false});assert.notEqual(unresolved.status,'closed');
const partial=await replyToSupport({kind:'account',messages:[...start,user('Fuck you')],historyComplete:false,allowAI:false});assert.notEqual(partial.status,'closed','Truncated history cannot establish that no unresolved issue exists');
const first=await replyToSupport({kind:'account',messages:[user('Give me my fucking refund')],evidence:[...checks,evidence],allowAI:false});assert.notEqual(first.status,'closed','Explain policy first');
late=true;evidence=await prepareSupportRefundEvidence(db,{accountId,threadId,requestId},checks,'live');assert.equal(evidence.refundCase.policyAcceptanceRecorded,false);late=false;
missing=true;evidence=await prepareSupportRefundEvidence(db,{accountId,threadId,requestId},checks,'live');assert.equal(evidence.refundCase.policyAcceptanceRecorded,false);missing=false;
wrongAccount=true;paths.length=0;evidence=await prepareSupportRefundEvidence(db,{accountId,threadId,requestId},checks,'live');assert.equal(evidence.refundCase.policyAcceptanceRecorded,false);assert(!paths.some(p=>p.startsWith('icash_membership_invoices')));wrongAccount=false;
outage=true;evidence=await prepareSupportRefundEvidence(db,{accountId,threadId,requestId},checks,'live');assert.equal(evidence.refundCase.policyAcceptanceRecorded,false);assert(evidence.refundCase.gaps.some(g=>g.includes('could not be verified')));
const unknown=await replyToSupport({kind:'account',messages:[...start,user('Give me my fucking refund')],evidence:[evidence],allowAI:false});assert.doesNotMatch(unknown.reply,/you accepted|you agreed|researched|course access/);
const bounded=await prepareSupportRefundEvidence(async()=>Array.from({length:6},()=>({recorded_at:stamp})),{accountId,threadId,requestId},[],'live');assert(bounded.refundCase.gaps.some(g=>g.includes('five latest')));
console.log('PASS refund evidence: account/mode binding, original acceptance before payment, unknown/gaps, bounded private snapshots, factual delivery, abusive repetition, guest privacy and unresolved-issue protection. No external calls.');
