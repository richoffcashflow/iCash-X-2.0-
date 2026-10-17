import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

process.env.STRIPE_WEBHOOK_SECRET='whsec_fixture';
let wakes=0,settlementFails=false;
let event,invoice,reads=[],synced=[],fail=false,member=true;
const deps={schedulePurchaseAccessEmail:()=>wakes++,settleMembershipInvoice:async()=>{if(settlementFails)throw Error('Settlement failed');return true;},NextResponse:{json:Response.json},fundingMode:()=> 'live',fundingStripe:()=>({
 webhooks:{constructEvent:(_body,sig)=>{if(sig!=='fixture')throw Error('Signature');return event;}},
 invoices:{retrieve:async id=>{reads.push(['invoice',id]);if(fail)throw Error('Private transport failure');return invoice;}},
 subscriptions:{retrieve:async id=>{reads.push(['subscription',id]);return {id,status:'past_due'};}}
}),syncMembershipSubscription:async sub=>{synced.push(['membership',sub]);return member;},syncDailySubscription:async sub=>synced.push(['daily',sub])};
globalThis.__invoiceWebhook=deps;
const code=ts.transpileModule(readFileSync(new URL('../app/api/webhooks/stripe/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .*;\s*$/gm,'');
const {POST}=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.__invoiceWebhook;\n'+code).toString('base64'));
const post=(sig='fixture')=>POST(new Request('https://www.geticashx.com/api/webhooks/stripe',{method:'POST',headers:{'stripe-signature':sig},body:'fixture'}));
function reset(type='invoice.payment_failed',legacy=true){reads=[];synced=[];fail=false;member=true;event={id:'evt_fixture',type,livemode:true,data:{object:{id:'in_fixture',...(legacy?{subscription:'sub_old_payload'}:{parent:{subscription_details:{subscription:'sub_old_payload'}}})}}};invoice={id:'in_fixture',livemode:true,parent:{subscription_details:{subscription:'sub_current'}}};}
for(const type of ['invoice.payment_failed','invoice.payment_action_required'])for(const legacy of [true,false]){
 reset(type,legacy);assert.equal((await post()).status,200);assert.deepEqual(reads,[['invoice','in_fixture'],['subscription','sub_current']]);assert.deepEqual(synced,[['membership',{id:'sub_current',status:'past_due'}]],'Canonical state wins over either webhook payload version');
}
reset();member=false;await post();assert.deepEqual(synced.map(s=>s[0]),['membership','daily']);
reset();invoice.parent=null;await post();assert.equal(synced.length,0,'Non-subscription invoices are ignored');
reset();invoice.parent.subscription_details.subscription={id:'sub_current'};await post();assert.equal(synced[0][1].id,'sub_current');
reset();fail=true;let response=await post();assert.equal(response.status,500);assert.equal(synced.length,0);assert(!JSON.stringify(await response.json()).includes('Private'));fail=false;assert.equal((await post()).status,200);assert.equal(synced.length,1,'A retried delivery recovers');
reset();assert.equal((await post('bad')).status,400);assert.equal(reads.length,0);event.livemode=false;assert.equal((await post()).status,400);assert.equal(reads.length,0);
reset();invoice.livemode=false;assert.equal((await post()).status,500);assert.equal(synced.length,0);
delete globalThis.__invoiceWebhook;
console.log('PASS Stripe invoice webhooks: old/new event formats, canonical subscription state, retries, non-subscription invoices, signature and mode gates. Fixture only.');

reset('invoice.paid');wakes=0;assert.equal((await post()).status,200);assert.equal(wakes,1,'Confirmed purchase immediately wakes the durable email');settlementFails=true;wakes=0;assert.equal((await post()).status,500);assert.equal(wakes,0,'Unverified payment never dispatches');
