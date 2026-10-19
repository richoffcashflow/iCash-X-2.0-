import {processInstantLeadWork} from '../lib/meta-instant-lead-service.ts';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
let allocation={status:'assigned',leadId:'recovered-lead'},target,allowed=true,calls=[],recoveryFails=false,recoveryWait,onResponse,emailWait,emailRuns=0;
const mocks={processInstantLeadWork,processSellerEmails:async()=>{emailRuns++;if(emailWait)await emailWait;return {status:'seller_emails_idle'};},dealEmailConfigured:()=>true,dispatchDealEmail:()=>{throw Error('No provider requests');},processSellerResearchRefresh:async()=>({status:'idle'}),authorizeOutboundBilling:()=>allowed,recoverAgreementDelivery:async()=>{if(recoveryFails)throw Error('Temporary receipt lookup failure');if(recoveryWait)await recoveryWait;return {status:'idle'};},sendForSignatures:()=>{},textPendingContract:()=>{},processSellerIntake:async()=>({status:'property_checked'}),deliverSellerEvent:async()=>({status:'idle'}),dispatchTextMessage:()=>{},dispatchLiveVoice:()=>{},db:async(path)=>{
 calls.push(path);
 if(path==='icash_seller_controls?id=eq.1&select=enabled')return [{enabled:true}];
 if(path==='rpc/icash_collect_seller_milestones')return [];
 if(path==='rpc/icash_assign_seller_lead')return allocation;
 throw Error('Unexpected database call');
},processSellerResponses:async(db,text,voice,leadId)=>{target=leadId;onResponse?.();return [{leadId,status:'queued'}];}};
globalThis.__queueHandoff=mocks;
let source=ts.transpileModule(readFileSync(new URL('../app/api/internal/seller/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
source='const {'+Object.keys(mocks).join(',')+'}=globalThis.__queueHandoff;\n'+source;
const route=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const req=new Request('https://www.geticashx.com/api/internal/seller');
assert.equal((await route.GET(req)).status,200);assert.equal(target,'recovered-lead','Recovered assignment bypasses unrelated setup retries');
allocation=null;assert.equal((await route.GET(req)).status,200);assert.equal(target,undefined,'An idle assignment tick still services the existing response queue');
allocation={status:'waiting_for_budget'};await route.GET(req);assert.equal(target,undefined);
recoveryFails=true;allocation={status:'assigned',leadId:'new-seller'};
const isolated=await route.GET(req);assert.equal(isolated.status,200);
const outcome=await isolated.json();assert.equal(outcome.agreementRecovery.status,'agreement_recovery_unavailable');
assert.equal(outcome.lookup.status,'property_checked');assert.equal(target,'new-seller','A broken agreement recovery cannot block a new seller response');
recoveryFails=false;let releaseRecovery;
recoveryWait=new Promise(resolve=>{releaseRecovery=resolve;});
const responded=new Promise(resolve=>{onResponse=resolve;});
const overlapping=route.GET(req);let timeout;
try{await Promise.race([responded,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('New seller waited for unrelated recovery')),1000);})]);}
finally{clearTimeout(timeout);releaseRecovery();}
assert.equal((await overlapping).status,200,'Both branches finish without abandoning the recovery');
recoveryWait=null;let releaseEmail;
emailWait=new Promise(resolve=>{releaseEmail=resolve;});
const respondedWhileEmailPending=new Promise(resolve=>{onResponse=resolve;});
const emailOverlapping=route.GET(req);
try{await Promise.race([respondedWhileEmailPending,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('New seller waited for unrelated email delivery')),1000);})]);}
finally{clearTimeout(timeout);releaseEmail();}
assert.equal((await emailOverlapping).status,200,'Seller responses progress while the independent email lane is pending');
allowed=false;calls=[];const emailsBeforeUnauthorized=emailRuns;assert.equal((await route.GET(req)).status,401);assert.equal(calls.length,0);assert.equal(emailRuns,emailsBeforeUnauthorized,'Unauthorized requests never start the email lane');
console.log('PASS immediate recovered-lead handoff, existing queue fallback and cron authentication.');
