import {runScreeningJob} from './screening-job.ts';
import {fullCostReserve,type CostQuote} from './cost-guard.ts';

/** Server-only preflight policy, NOT a provider dispatch or spending authorization.
 * Use complete, account-scoped database matches; never accept this input from a
 * caller, model, request body or caller-ID-authenticated customer session. */
export type ReturningSellerCandidate={
 account_id:string;screening_id:string;deal_id:string;party:'seller'|'buyer';
 deal:{id:string;account_id:string;screening_id:string;stage:string;terms:Record<string,unknown>};
 screening:{id:string;account_id:string;state:string;completed_at:string|null;snapshot:unknown};
 envelope?:{account_id:string;deal_id:string;kind:string;state:string;test_mode:boolean;provider_id:string|null;terms:Record<string,unknown>}|null;
 account:{id:string;bot_paused:boolean;daily_limit_cents:number};
 wallet:{account_id:string;balance_cents:number;reserved_cents:number};
 usage_24h_cents:number;budget_read_at:number;manual:boolean;suppressed:boolean;
 rate:{id:string;operation:string;enabled:boolean;charge_cents:number;verified_at:string;expires_at:string;voice_max_duration_seconds:number;costs_micros:unknown;buffer_bps:number}|null;
};
export type InboundValueDecision={
 action:'identify_without_customer_charge'|'reserve_customer_call'|'reject_paid_call';
 reason:string;priority:'signing_or_active_deal'|'qualification';
 // Contains routing IDs only; it must never be sent to the voice model/caller.
 binding?:{accountId:string;screeningId:string;dealId:string;rateId:string};
 customerChargeAuthorized:false;storedFactsDisclosureAuthorized:false;outboundAuthorized:false;
};
const uuid=(v:string)=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>[k,canonical(x)])):v;
const activeStages=new Set(['under_contract','buyer_selected','title_open','closing']);
function result(action:InboundValueDecision['action'],reason:string,priority:InboundValueDecision['priority']='qualification',binding?:InboundValueDecision['binding']):InboundValueDecision{
 return {action,reason,priority,...(binding?{binding}:{}),customerChargeAuthorized:false,storedFactsDisclosureAuthorized:false,outboundAuthorized:false};
}
export function decideReturningSeller(input:{matches:ReturningSellerCandidate[];matchesComplete:boolean;verifiedIngressAccountId:string|null;now:number;maxSeconds:number}):InboundValueDecision{
 const {matches,now,maxSeconds}=input;
 if(!Number.isFinite(now)||!Number.isInteger(maxSeconds)||maxSeconds<60||maxSeconds>300)return result('reject_paid_call','invalid_policy_input');
 // Count ALL open property/account matches BEFORE affordability/eligibility
 // filtering. Never choose the sole good/funded candidate out of ambiguous ones.
 if(!input.matchesComplete||matches.length!==1)return result('identify_without_customer_charge',matches.length>1?'ambiguous_property_or_account':'unknown_or_incomplete_match');
 const c=matches[0],d=c.deal,s=c.screening,e=c.envelope;
 if(!input.verifiedIngressAccountId||input.verifiedIngressAccountId!==c.account_id)return result('identify_without_customer_charge','verified_called_number_account_required');
 if(![c.account_id,c.screening_id,c.deal_id].every(uuid)||c.party!=='seller'||d.id!==c.deal_id||d.account_id!==c.account_id||d.screening_id!==c.screening_id||s.id!==c.screening_id||s.account_id!==c.account_id||c.account.id!==c.account_id||c.wallet.account_id!==c.account_id)return result('identify_without_customer_charge','untrusted_or_cross_account_binding');
 const signing=e&&e.account_id===c.account_id&&e.deal_id===c.deal_id&&e.kind==='purchase'&&e.test_mode===false&&!!e.provider_id&&JSON.stringify(canonical(e.terms))===JSON.stringify(canonical(d.terms))&&['awaiting_counterparty','customer_signature_needed'].includes(e.state);
 const priority=activeStages.has(d.stage)||signing?'signing_or_active_deal':'qualification';
 if(c.suppressed||c.account.bot_paused||c.manual)return result('reject_paid_call','paused_suppressed_or_manual',priority);
 if(d.terms.practice===true||d.terms.practice==='true'||['closed','cancelled'].includes(d.stage))return result('identify_without_customer_charge','not_an_open_live_deal',priority);
 if(!['draft',...activeStages].includes(d.stage))return result('identify_without_customer_charge','unrecognized_deal_stage',priority);
 const completed=Date.parse(s.completed_at??'');
 let screen:ReturnType<typeof runScreeningJob>;
 try{
  if(s.state!=='complete'||!Number.isFinite(completed)||completed>now||now-completed>86400000)throw Error();
  screen=runScreeningJob(s.snapshot,now);
 }catch{return result('identify_without_customer_charge','stale_or_missing_underwriting',priority);}
 if(screen.financialCheck.status!=='eligible'){
  const property=screen.property,financial=property.financialScreening,snapshot=obj(s.snapshot),reserve=snapshot.sellerCostReserveCents;
  // Distinguish fresh numerical non-viability from missing, conflicting, lien,
  // land or title evidence. A generic financialCheck hold is not a bad lead.
  const definitive=snapshot.propertyType==='house'&&financial.status!=='conflicting_data'&&(
   (financial.equityMinimum.percent!==null&&financial.equityMinimum.percent<70)||
   (screen.preliminarySellerCeilingCents===null&&property.screeningBuyerCeilingCents!==null)||
   (screen.preliminarySellerCeilingCents!==null&&financial.estimatedLoanBalanceCents!==null&&integer(reserve)&&financial.estimatedLoanBalanceCents>=screen.preliminarySellerCeilingCents-reserve));
  // Preserve a contract-stage caller for bounded identification/review when
  // financial evidence conflicts with an active deal. Do not silently drop it.
  return result(definitive&&priority==='qualification'?'reject_paid_call':'identify_without_customer_charge',definitive?'fresh_numbers_do_not_support_paid_qualification':'underwriting_requires_review',priority);
 }
 const r=c.rate;
 if(!r||r.operation!=='incoming_call'||!r.enabled||!uuid(r.id)||!integer(r.charge_cents)||r.charge_cents<=0||!Number.isInteger(r.voice_max_duration_seconds)||r.voice_max_duration_seconds<maxSeconds||!Number.isFinite(Date.parse(r.verified_at))||Date.parse(r.verified_at)>now||Date.parse(r.expires_at)<=now||!Number.isFinite(Date.parse(r.expires_at)))return result('reject_paid_call','reviewed_incoming_rate_required',priority);
 const cost=fullCostReserve({rateVersion:r.id,checkedAt:Date.parse(r.verified_at),expiresAt:Date.parse(r.expires_at),amountsMicros:r.costs_micros as CostQuote['amountsMicros'],bufferBasisPoints:r.buffer_bps},now);
 if(!cost.ok)return result('reject_paid_call','unknown_or_expired_provider_cost',priority);
 if(!Number.isFinite(c.budget_read_at)||c.budget_read_at>now||now-c.budget_read_at>30000||![c.account.daily_limit_cents,c.wallet.balance_cents,c.wallet.reserved_cents,c.usage_24h_cents].every(integer))return result('reject_paid_call','fresh_customer_budget_required',priority);
 // BigInt avoids overflow in aggregate amounts. Database reservation repeats
 // these checks under locks, including company margin/protected operating funds.
 if(BigInt(c.wallet.balance_cents)-BigInt(c.wallet.reserved_cents)<BigInt(r.charge_cents)||BigInt(c.usage_24h_cents)+BigInt(c.wallet.reserved_cents)+BigInt(r.charge_cents)>BigInt(c.account.daily_limit_cents))return result('reject_paid_call','existing_customer_budget_exhausted',priority);
 return result('reserve_customer_call','eligible_for_atomic_customer_reservation',priority,{accountId:c.account_id,screeningId:c.screening_id,dealId:c.deal_id,rateId:r.id});
}

/** Bounded conversation pacing based on actual progress, never question count.
 * Signals describe this call only. They grant no tools, fees, follow-up or consent.
 * A deterministic provider duration cap always remains authoritative. */
export function decideCallProgress(input:{elapsedSeconds:number;maxSeconds:number;callerAskedToStop:boolean;optedOut:boolean;explicitlyNotReady:boolean;legitimateQuestionPending:boolean;newPropertyOrTermsInformation:boolean;nextStepProgress:boolean;readinessClarificationGiven:boolean;repeatedOffTopicAfterRedirect:boolean;repeatingAnsweredQuestionWithoutNewIssue:boolean}){
 const finish=(reason:string,message:string)=>({action:'end' as const,reason,message,outboundAuthorized:false as const});
 if(input.optedOut||input.callerAskedToStop)return finish('caller_requested_stop',"Understood. I'll end the call now.");
 if(!Number.isFinite(input.elapsedSeconds)||input.elapsedSeconds<0||!Number.isInteger(input.maxSeconds)||input.maxSeconds<60||input.maxSeconds>300)return finish('invalid_time_bound','Thanks for calling. Please call back when you’re ready.');
 if(input.elapsedSeconds>=input.maxSeconds-5)return finish('duration_cap','Thanks for calling. You’re welcome to call back when you’re ready to continue.');
 if(input.explicitlyNotReady)return finish('not_ready','No problem. You’re welcome to call back when you’re ready.');
 if(input.legitimateQuestionPending)return {action:'answer_briefly' as const,reason:'reasonable_property_price_or_process_question',outboundAuthorized:false as const};
 if(input.newPropertyOrTermsInformation||input.nextStepProgress)return {action:'continue' as const,reason:'substantive_progress',outboundAuthorized:false as const};
 const repeated=input.repeatedOffTopicAfterRedirect||input.repeatingAnsweredQuestionWithoutNewIssue;
 if(repeated&&input.readinessClarificationGiven)return finish('confirmed_no_progress','Let’s leave it here for now. You’re welcome to call back when you’re ready to discuss the property or next step.');
 return {action:'clarify_readiness' as const,reason:'check_readiness_without_pressure',message:'Is there a property question or next step you’d like to work through now?',outboundAuthorized:false as const};
}
