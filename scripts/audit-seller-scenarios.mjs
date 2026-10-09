// Read-only application audit. Synthetic fixtures only; never calls a provider.
// Usage: node --experimental-strip-types scripts/audit-seller-scenarios.mjs <local-pglite-module> <output-json>
// Exits 1 when a desired seller outcome fails, 2 for a setup error. This is deliberately
// separate from test-all: a reproduced gap must not be mistaken for a passing test.
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {calculateAutomaticCallOffer} from '../lib/automatic-call-offer.ts';
import {callOfferEvidence} from '../lib/call-offer-evidence.ts';
import {sellerPayoffEvidence,sellerPayoffPosition} from '../lib/seller-payoff.ts';
import {sellerListingEvidence} from '../lib/seller-listing.ts';
import {validateTextAnalysis} from '../lib/text-ai-policy.ts';
import {isMessageOptOut} from '../lib/contiguity.ts';
import {confirmedSellerTerms} from '../lib/seller-agreement-flow.ts';
import {dealTermsSchema} from '../lib/deal-documents.ts';
import {callbackDecision} from '../lib/callback-policy.ts';
import {contractReadiness} from '../lib/contract-readiness.ts';
import {nextClosingStage} from '../lib/closing-workflow.ts';
import {sellerViewingSlots,buyerDepositCents} from '../lib/buyer-purchase-terms.ts';

if(!process.argv[2]||!process.argv[3])throw Error('Supply a local PGlite module path and output JSON path.');
// Any accidental use of fetch in a future imported implementation fails locally.
globalThis.fetch=async()=>{throw Error('NETWORK_DISABLED_IN_SELLER_AUDIT');};
const results=[],now=Date.now(),address='45 Example Road';
const transcript=(question,answer)=>({transcript:[{role:'agent',message:question},{role:'user',message:answer}]});
async function check(id,stage,scenario,expectedAction,source,expected,run,priority='P1'){
 let actual,status;
 try{actual=await run();status=isDeepStrictEqual(actual,expected)?'PASS':'GAP';}
 catch(error){actual={error:error.message};status='ERROR';}
 results.push({id,stage,scenario,expectedAction,priority,status,expected,actual,evidence:'Executed local check',source});
}
const errorOf=fn=>{try{fn();return null;}catch(error){return error.message;}};
const analysis=body=>validateTextAnalysis({action:'ask_condition',reply:'',summary:'',facts:[]},[body],'seller',true);
const payoff=(q,a)=>sellerPayoffEvidence(transcript(q,a),{action:'report_change',sellerStatement:a});
const snapshot={propertyId:'prop_123',propertyType:'house',fetchedAt:new Date(now).toISOString(),sellerCostReserveCents:0,raw:{data:{dm_property_id:'prop_123',full_address:address,estimated_value:200000,estimated_repair_cost:40000,total_estimated_loan_balance:20000,estimated_equity_percentage:90}}};
const context={party:'seller',address,snapshot};
const offer=(state={},ctx=context)=>calculateAutomaticCallOffer(ctx,state,now);
if(offer().priceCents!==10200000||offer().contractAllowed!==true)throw Error('AUDIT_FIXTURE_INVALID: baseline property must support a $102,000 offer.');

for(const [n,body] of ['STOP','Please stop.','Stop please.','Dont text me again.','Please remove me.','Do not contact me.','Leave me alone.','Unsubscribe'].entries())
 await check(`CONTACT-${n+1}`,'Contact permission',body,'Persist contact suppression and cancel queued outreach.','lib/contiguity.ts:isMessageOptOut',true,()=>isMessageOptOut(body),'P0');
for(const [n,body,expected] of [[1,'Not now, call me tomorrow.',true],[2,'Call me tomorrow.',true],[3,'I missed your call.',false],[4,'Wrong number.',false]])
 await check(`CALLBACK-TEXT-${n}`,'Callback',body,'Recognize a callback separately from refusal; ask only for missing scheduling details.','lib/text-ai-policy.ts:validateTextAnalysis',expected,()=>analysis(body).callRequested);
await check('IDENTITY-1','First conversation','Are you a real person?','Answer honestly and continue the current context.','lib/text-ai-policy.ts:validateTextAnalysis','reply_identity',()=>analysis('Are you a real person?').action);
await check('HUMAN-1','Human handoff','I want to talk to a human.','Pause automation and request a person.','lib/text-ai-policy.ts:validateTextAnalysis',true,()=>analysis('I want to talk to a human.').humanRequested);
await check('CONTACT-9','Contact permission','Mixed message: STOP, call me tomorrow.','Hold conflicting stop/callback instructions for clarification; do not queue a callback.','lib/text-ai-policy.ts:validateTextAnalysis',false,()=>analysis('STOP, call me tomorrow.').callRequested,'P0');

const offerQ='Our cash offer is $102,000. Does that work for you?';
for(const [n,answer,expected] of [[1,'Yes.',true],[2,'No.',false],[3,'Yes, but I need $110,000.',false],[4,'Yes if you close tomorrow.',false],[5,'That works.',true],[6,'Sounds good.',true]])
 await check(`ACCEPT-${n}`,'Offer acceptance',answer,'Accept only an unqualified yes to the exact currently quoted price.','lib/call-offer-evidence.ts:callOfferEvidence',expected,()=>callOfferEvidence(transcript(offerQ,answer),{action:'accept_offer',priceCents:10200000}),'P0');
for(const [n,answer] of ['I am not ready to sell.','Wait, I need to think.','I never agreed to that.','Actually I need my spouse to agree first.','I changed my mind.','Cancel the agreement.'].entries())
 await check(`WITHDRAW-${n+1}`,'Offer acceptance',`After an earlier yes: ${answer}`,'Invalidate acceptance and resolve the latest objection before preparing an agreement.','lib/call-offer-evidence.ts:callOfferEvidence',false,()=>callOfferEvidence({transcript:[...transcript(offerQ,'Yes.').transcript,{role:'agent',message:'What is your full legal name?'},{role:'user',message:answer}]},{action:'accept_offer',priceCents:10200000}),'P0');
await check('ACCEPT-7','Offer acceptance','Seller accepts a different spoken price','Hold until the exact current price is confirmed.','lib/call-offer-evidence.ts:callOfferEvidence',false,()=>callOfferEvidence(transcript('Our cash offer is $85,000.','Yes.'),{action:'accept_offer',priceCents:10200000}),'P0');

const debtQ='Are there any other loans, liens, unpaid taxes or HOA balances?';
for(const [n,answer,expected] of [[1,'No.',{otherDebtCents:0}],[2,'No, there is a lien.',null],[3,'No, there are unpaid taxes.',null],[4,'No other loans, but unpaid taxes remain.',null],[5,'I owe $5,000 in taxes.',{otherDebtCents:500000}],[6,'Not sure.',null],[7,'Between $2,000 and $4,000.',null]])
 await check(`DEBT-${n}`,'Mortgage and liens',answer,'Preserve qualifications and debt disclosures; unknown additional debt must not become zero.','lib/seller-payoff.ts:sellerPayoffEvidence',expected,()=>payoff(debtQ,answer),'P0');
for(const [n,answer,expected] of [[8,'My mortgage is $20,000.',{mortgageCents:2000000}],[9,'The house is paid off.',{mortgageCents:0}],[10,'I do not owe anything.',{mortgageCents:0}],[11,'Not sure, maybe $20,000.',null],[12,'The other owner owes $20,000.',null]])
 await check(`DEBT-${n}`,'Mortgage and liens',answer,'Record only an unambiguous seller-reported balance, or ask for clarification.','lib/seller-payoff.ts:sellerPayoffEvidence',expected,()=>payoff('What is the mortgage payoff?',answer),'P1');
for(const [n,answer,expected] of [[1,'Yes.',{coveredShortfallCents:1000000,coverageDeclined:false}],[2,'No.',{coveredShortfallCents:0,coverageDeclined:true}],[3,'Yes if I can borrow it.',null]])
 await check(`SHORTFALL-${n}`,'Mortgage and liens',answer,'Capture ability to cover the stated $10,000 shortfall without treating conditional funding as available.','lib/seller-payoff.ts:sellerPayoffEvidence',expected,()=>payoff('Can you bring the $10,000 shortfall to closing?',answer),'P0');
await check('SHORTFALL-4','Mortgage and liens','Debt exceeds price; seller cannot cover difference','Keep contract preparation blocked.','lib/seller-payoff.ts:sellerPayoffPosition',false,()=>sellerPayoffPosition({mortgageCents:11000000,otherDebtCents:0,coverageDeclined:true},10200000).canProceed,'P0');

for(const [id,scenario,state,expected] of [
 ['PRICE-1','Current value $200,000; repairs $40,000; fee $10,000',{},10200000],
 ['PRICE-2','Repairs increase to $60,000',{repairEstimateCents:6000000},8800000],
 ['PRICE-3','Seller claims lower repairs than research',{repairEstimateCents:1000000},10200000],
 ['PRICE-4','A lower $90,000 price was already accepted',{acceptedPriceCents:9000000},9000000]
])await check(id,'Pricing',scenario,'Use supported numbers and preserve an already agreed lower price.','lib/automatic-call-offer.ts:calculateAutomaticCallOffer',expected,()=>offer(state).priceCents);
for(const [n,state] of [{acceptedPriceCents:11000000},{conditionPending:true},{factsPending:true},{agreementRevisionRequired:true},{listedWithAgent:true}].entries())
 await check(`PRICE-HOLD-${n+1}`,'Pricing',JSON.stringify(state),'Hold price/contract discussion while this material issue is unresolved.','lib/automatic-call-offer.ts:calculateAutomaticCallOffer',false,()=>offer(state).quoteAllowed,'P0');
for(const [id,ctx] of [['STALE',{...context,snapshot:{...snapshot,fetchedAt:new Date(now-86400001).toISOString()}}],['ADDRESS',{...context,address:'Different property'}],['LAND',{...context,snapshot:{...snapshot,propertyType:'land'}}],['VALUE',{...context,snapshot:{...snapshot,raw:{data:{...snapshot.raw.data,estimated_value:null}}}}]])
 await check(`RESEARCH-${id}`,'Property research',id,'Hold until the right property has current, applicable research.','lib/automatic-call-offer.ts:calculateAutomaticCallOffer',false,()=>offer({},ctx).quoteAllowed,'P0');
await check('PRICE-5','Pricing','Low equity with unresolved mortgage','Discuss a conditional price but block contract preparation.','lib/automatic-call-offer.ts:calculateAutomaticCallOffer',false,()=>offer({},{...context,snapshot:{...snapshot,raw:{data:{...snapshot.raw.data,total_estimated_loan_balance:180000,estimated_equity_percentage:20}}}}).contractAllowed,'P0');

for(const [n,answer,expected] of [[1,'Yes.',true],[2,'No.',false],[3,'I might list it with a realtor.',null],[4,'It is not listed with an agent.',false],[5,'It is not listed, but I have an agent agreement.',null]])
 await check(`LISTING-${n}`,'Ownership and listing',answer,'Clarify conflicting representation facts before quoting or ending the lead.','lib/seller-listing.ts:sellerListingEvidence',expected,()=>sellerListingEvidence(transcript('Is it listed with an agent?',answer),{action:'report_change',sellerStatement:answer}));

const future=new Date(now+14*86400000).toISOString().slice(0,10);
const terms=dealTermsSchema.parse({address,buyer:'Fixture Buyer',state:'TX',legalDescription:'Fixture lot 1',earnestCents:0});
const confirm={sellerLegalName:'Fixture Seller',agreedPriceCents:9000000,closingDate:future,soleOwner:true,allDecisionMakersAgree:true,inspectionAccess:'yes',priceAndDateConfirmed:true,termsConfirmed:true,sendTextRequested:true,materialFactsChanged:false};
const termContext={address,principal:terms.buyer,legalDescription:terms.legalDescription,ceilingCents:10200000,now};
for(const [n,patch,expected] of [[1,{soleOwner:false},'all_owners_required'],[2,{allDecisionMakersAgree:false},'all_owners_required'],[3,{sendTextRequested:false},'confirmation_required'],[4,{termsConfirmed:false},'confirmation_required'],[5,{materialFactsChanged:true},'updated_property_review_required'],[6,{agreedPriceCents:10300000},'price_review_required'],[7,{closingDate:'2000-01-01'},'closing_date_review_required'],[8,{inspectionAccess:'no'},null]])
 await check(`CONTRACT-${n}`,'Purchase contract',JSON.stringify(patch),'Require valid confirmations; declining a visit alone does not waive terms or kill the deal.','lib/seller-agreement-flow.ts:confirmedSellerTerms',expected,()=>errorOf(()=>confirmedSellerTerms(terms,{...confirm,...patch},termContext)),'P0');
await check('CONTRACT-9','Purchase contract','Seller purchase deposit','Do not add buyer-assignment deposit rules to the seller purchase agreement.','lib/seller-agreement-flow.ts:confirmedSellerTerms',null,()=>confirmedSellerTerms(terms,confirm,termContext).earnestCents);
const ready={agreedPriceCents:9000000,approvedCeilingCents:10200000,allDecisionMakersPresent:true,allOwnersConfirmed:true,legalDescription:'Fixture lot',legalDescriptionReviewed:true,sellerSignaturesVerified:false,customerSignatureVerified:false,autoSignAuthorization:null,documentHash:'a'.repeat(64),now};
for(const [n,patch,expected] of [[1,{},'seller_signs_first'],[2,{sellerSignaturesVerified:true},'request_customer_signature'],[3,{sellerSignaturesVerified:true,customerSignatureVerified:true},'fully_signed'],[4,{allOwnersConfirmed:false},'wait_for_decision_makers'],[5,{legalDescriptionReviewed:false},'review_legal_description']])
 await check(`SIGN-${n}`,'Signatures',JSON.stringify(patch),'Advance only on verified signatures and required owners/terms.','lib/contract-readiness.ts:contractReadiness',expected,()=>contractReadiness({...ready,...patch}),'P0');

const cb={id:'fixture',opportunityId:'fixture',dueAt:now,sellerTimeZone:'America/Chicago',timeConfirmed:true,completed:false,canceled:false};
const cbCtx={now,permitted:true,contactWindowOpen:true,humanTakeover:false,botPaused:false,creditsReserved:true,exclusiveLease:true,maxLatenessMs:300000};
for(const [n,j,c,expected] of [[1,{}, {},'ready'],[2,{timeConfirmed:false},{},'needs_confirmation'],[3,{}, {humanTakeover:true},'paused'],[4,{}, {permitted:false},'blocked_by_permission'],[5,{canceled:true},{},'do_not_dispatch'],[6,{}, {exclusiveLease:false},'already_claimed'],[7,{}, {now:now+600000},'missed_callback_review'],[8,{}, {contactWindowOpen:false},'outside_contact_hours']])
 await check(`CALLBACK-${n}`,'Callback',JSON.stringify({...j,...c}),'Dispatch once only at an allowed, confirmed time and recheck current controls.','lib/callback-policy.ts:callbackDecision',expected,()=>callbackDecision({...cb,...j},{...cbCtx,...c}));

await check('POSTSIGN-1','After contract','Returning seller already has a signed contract','Resume access coordination; do not requalify or quote a new offer.','lib/automatic-call-offer.ts:calculateAutomaticCallOffer','seller_viewing_coordination',()=>offer({},{...context,sellerContractSigned:true}).status);
await check('VIEW-PUBLIC-1','Viewing','Expired slot','Do not advertise past availability.','lib/buyer-purchase-terms.ts:sellerViewingSlots',[],()=>sellerViewingSlots([{startsAt:new Date(now-1000).toISOString(),endsAt:null,timezone:'America/Chicago'}],now));
await check('VIEW-PUBLIC-2','Viewing','Slot contains private access code','Only publish time fields.','lib/buyer-purchase-terms.ts:sellerViewingSlots',false,()=>JSON.stringify(sellerViewingSlots([{startsAt:new Date(now+86400000).toISOString(),endsAt:null,timezone:'America/Chicago',accessCode:'PRIVATE'}],now)).includes('PRIVATE'),'P0');
for(const [n,fee,expected] of [[1,1000000,200000],[2,5000000,500000]])
 await check(`DEPOSIT-${n}`,'Buyer handoff',`Assignment fee in cents: ${fee}`,'Calculate 20% of assignment fee, capped at $5,000, only on the buyer side.','lib/buyer-purchase-terms.ts:buyerDepositCents',expected,()=>buyerDepositCents(fee));
const closing={outreachPaused:false,sellerAgreementApproved:true,sellerContractSigned:true,buyerAgreementApproved:true,buyerAgreementSigned:true,buyerClosingCostsInSignedTerms:true,depositTermsInSignedAgreement:true,escrowAgentVerified:true,titleInstructionsVerified:true,paymentLinkFromEscrow:true,depositConfirmedByEscrow:true,closeConfirmedByTitle:false};
await check('CLOSE-1','Closing','Seller says the sale is closed; title has not confirmed','Keep closing incomplete.','lib/closing-workflow.ts:nextClosingStage','Missing verified condition: closeConfirmedByTitle',()=>errorOf(()=>nextClosingStage('closing_scheduled','confirm_closed',closing)),'P0');
await check('CLOSE-2','Closing','Verified title close confirmation','Advance to closed.','lib/closing-workflow.ts:nextClosingStage','closed',()=>nextClosingStage('closing_scheduled','confirm_closed',{...closing,closeConfirmedByTitle:true}));

// Execute exact shipped SQL functions in an isolated database. Minimal fixture
// tables provide their dependencies; this is not a production migration test.
const {PGlite}=await import(pathToFileURL(process.argv[2]).href),pg=await PGlite.create();
const functionSql=(file,name)=>{
 const source=readFileSync(new URL('../config/'+file+'.sql',import.meta.url),'utf8');
 const start=source.indexOf('create function public.'+name+'(');
 if(start<0)throw Error(`Missing source function ${name}`);
 const body=source.indexOf('$$',start),end=source.indexOf('$$;',body+2);
 if(body<0||end<0)throw Error(`Missing SQL body ${name}`);
 return source.slice(start,end+3);
};
const one=async(sql,args=[])=>(await pg.query(sql,args)).rows[0];
try{
 await pg.exec(`create table icash_text_threads(id uuid,account_id uuid,deal_id uuid,party text,retired_at timestamptz,timezone text);
 create table icash_deal_files(id uuid,account_id uuid,screening_id uuid,stage text,terms jsonb);
 create table icash_signing_envelopes(account_id uuid,deal_id uuid,kind text,state text,test_mode boolean);
 create table icash_seller_viewing_availability(id uuid default gen_random_uuid(),account_id uuid,deal_id uuid,screening_id uuid,thread_id uuid,source text,source_id uuid,quote text,slots jsonb,state text,timezone text,stated_at timestamptz,created_at timestamptz default now(),unique(source,source_id));`);
 for(const name of ['icash_parse_viewing_slot','icash_capture_seller_viewing','icash_current_viewing_slots'])await pg.exec(functionSql('seller-viewing-availability-and-buyer-intent',name));
 const a=randomUUID(),d=randomUUID(),s=randomUUID(),t=randomUUID();
 await pg.query("insert into icash_text_threads values($1,$2,$3,'seller',null,'America/Chicago')",[t,a,d]);
 await pg.query("insert into icash_deal_files values($1,$2,$3,'under_contract','{}')",[d,a,s]);
 await pg.query("insert into icash_signing_envelopes values($1,$2,'purchase','completed',false)",[a,d]);
 const date=new Date(now+3*86400000).toISOString().slice(0,10),exact=`${date} 2 PM to 4 PM central`,q='What viewing dates and times are available?';
 async function capture(turns){
  await pg.exec('truncate icash_seller_viewing_availability');
  await pg.query('select icash_capture_seller_viewing($1,$2,$3,\'call\',$4,$5,$6)',[a,d,t,randomUUID(),JSON.stringify(turns),new Date(now).toISOString()]);
  return (await one('select state,jsonb_array_length(slots) n from icash_seller_viewing_availability'))??null;
 }
 const turn=(role,message)=>({role,message});
 const viewCases=[
  ['VIEW-1','One complete viewing window',[turn('agent',q),turn('user',exact)],{state:'available',n:1}],
  ['VIEW-2','Unclear time, then exact answer in the same call',[turn('agent',q),turn('user','Maybe next week.'),turn('agent',q),turn('user',exact)],{state:'available',n:1}],
  ['VIEW-3','Withdraw old time, then supply replacement in the same call',[turn('agent',q),turn('user','Cancel my old viewing time.'),turn('agent',q),turn('user',exact)],{state:'available',n:1}],
  ['VIEW-4','Explicit withdrawal only',[turn('agent',q),turn('user','Cancel my viewing time.')],{state:'withdrawn',n:0}],
  ['VIEW-5','Missing timezone',[turn('agent',q),turn('user',`${date} 2 PM`)],{state:'needs_review',n:0}],
  ['VIEW-6','Two complete windows',[turn('agent',q),turn('user',exact),turn('agent',q),turn('user',`${date} 5 PM to 6 PM central`)],{state:'available',n:2}],
  ['VIEW-7','Seller corrects the window without repeating the word viewing',[turn('agent',q),turn('user',exact),turn('agent','Anything else?'),turn('user',`Actually make it ${date} 5 PM to 6 PM central.`)],{state:'needs_review',n:0}]
 ];
 for(const [id,scenario,turns,expected] of viewCases)await check(id,'Viewing',scenario,'Keep only the latest confirmed seller availability; clarification must recover without publishing an outdated time.','config/seller-viewing-availability-and-buyer-intent.sql:icash_capture_seller_viewing',expected,()=>capture(turns));
 await check('VIEW-8','Viewing','DST clock repeats 1:30 AM','Request an unambiguous viewing time.','config/seller-viewing-availability-and-buyer-intent.sql:icash_parse_viewing_slot',null,async()=>(await one("select icash_parse_viewing_slot('2026-11-01 1:30 AM central','2026-10-09T21:00:00Z') v")).v);
}finally{await pg.close();}

const report={commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),createdAt:new Date().toISOString(),scope:'Local deterministic functions and isolated PostgreSQL checks. No live calls, messages, signatures, model completions or database changes.',summary:{checks:results.length,passed:results.filter(r=>r.status==='PASS').length,gaps:results.filter(r=>r.status==='GAP').length,errors:results.filter(r=>r.status==='ERROR').length},results};
writeFileSync(process.argv[3],JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.summary));
for(const r of results.filter(r=>r.status!=='PASS'))console.log(`${r.status} ${r.id}: ${r.scenario} | expected ${JSON.stringify(r.expected)} | observed ${JSON.stringify(r.actual)}`);
process.exitCode=report.summary.errors?2:report.summary.gaps?1:0;
