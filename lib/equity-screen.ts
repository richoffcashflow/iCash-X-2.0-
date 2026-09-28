/** Preliminary screening, never a payoff statement, title clearance or authority to close. */
function money(v:unknown,signed=false){if(typeof v!=='number'||!Number.isFinite(v)||(!signed&&v<0))return null;const n=Math.round(v*100);return Number.isSafeInteger(n)?n:null;}
function bool(v:unknown){return typeof v==='boolean'?v:null;}
function count(v:unknown){return typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:null;}
export function screenEquity(d:Record<string,unknown>,buyerCeilingCents:number|null){
 const equityCents=money(d.estimated_equity_amount,true),valueCents=money(d.estimated_value);
 const reportedLoanCents=money(d.total_estimated_loan_balance);
 const derived=valueCents!==null&&equityCents!==null?valueCents-equityCents:null;
 const derivedLoanCents=derived!==null&&Number.isSafeInteger(derived)&&derived>=0?derived:null;
 // Prefer the explicitly reported mortgage estimate. A derived balance is separately labeled.
 const loanCents=reportedLoanCents??derivedLoanCents;
 const lienAmountCents=money(d.total_open_lien_amount);
 const activeLiens=count(d.num_total_active_liens),openLiens=count(d.num_total_open_liens);
 const activeLien=bool(d.has_active_lien),hoaLien=bool(d.has_hoa_lien),taxDelinquent=bool(d.is_tax_delinquent),freeAndClear=bool(d.is_free_and_clear);
 const lienFlag=activeLien===true||hoaLien===true||(activeLiens??0)>0||(openLiens??0)>0||(lienAmountCents??0)>0;
 const inconsistent=(freeAndClear===true&&((loanCents??0)>0||lienFlag))||(derived!==null&&derived<0);
 const above=buyerCeilingCents!==null&&loanCents!==null&&loanCents>=buyerCeilingCents;
 const status=inconsistent?'conflicting_data':above?'payoff_may_exceed_budget':lienFlag||taxDelinquent===true?'title_review_needed':loanCents===null?'debt_unknown':'payoff_verification_needed';
 const reasons:string[]=[];
 if(inconsistent)reasons.push('Provider records conflict; verify before relying on them.');
 if(above)reasons.push('Estimated mortgage debt reaches or exceeds the preliminary ceiling, even before assignment fee and closing adjustments.');
 if(equityCents!==null&&equityCents<0)reasons.push('Estimated equity is negative.');
 if(lienFlag)reasons.push('Provider reports a lien indicator; title must identify the creditor, amount and release requirements.');
 if(taxDelinquent===true)reasons.push('Provider reports delinquent taxes; obtain current amounts.');
 if(loanCents===null)reasons.push('Mortgage balance is unknown, not zero.');
 reasons.push('Confirm actual payoff, other debts, seller proceeds and all required owners with title before closing.');
 return {status,equityCents,estimatedLoanBalanceCents:loanCents,loanSource:reportedLoanCents!==null?'reported_estimate':derivedLoanCents!==null?'derived_from_value_minus_equity':'unknown',
  lienAmountCents,activeLiens,openLiens,activeLien,hoaLien,taxDelinquent,freeAndClear,
  // Lien totals may include mortgages: never add overlapping totals automatically.
  lienAndMortgageTotalsCombined:false,titleStatus:'unverified' as const,payoffVerified:false as const,
  fundsAfterEstimatedMortgageBeforeFeesCents:buyerCeilingCents!==null&&loanCents!==null?buyerCeilingCents-loanCents:null,
  priority:inconsistent||above?'review_before_more_spend':'verify_during_qualification',reasons,
  questions:['About how much is left on the mortgage, including any second mortgage or HELOC?','Are there unpaid property taxes, HOA balances, judgments or other liens?','Is anyone else on the deed who needs to agree to the sale?','How much do you need to walk away with after everything is paid off?'],
  dealApproved:false as const};
}

/** Run before reserving funds for any seller call; all inputs come from server underwriting. */
export function sellerCallFinancialGate(screen:ReturnType<typeof screenEquity>,input:{sellerOfferCents:number|null;sellerCostReserveCents:number|null;checkedAt:number}){
 const money=(n:number|null)=>n!==null&&Number.isSafeInteger(n)&&n>=0;
 let reason='';
 if(!Number.isFinite(input.checkedAt))throw new Error('Invalid screening time');
 if(screen.status==='conflicting_data')reason='Resolve conflicting property records before calling.';
 else if(!money(input.sellerOfferCents)||input.sellerOfferCents===0)reason='No viable seller offer budget after repairs and assignment fee.';
 else if(screen.estimatedLoanBalanceCents===null)reason='Verify missing debt data before spending on a call.';
 else if(!money(input.sellerCostReserveCents))reason='Set the seller closing-cost reserve before calling.';
 else if(screen.estimatedLoanBalanceCents! >= input.sellerOfferCents! - input.sellerCostReserveCents!)reason='Estimated debt consumes the available seller offer; hold for review.';
 // Liens need a payoff/release budget. Do not add potentially overlapping provider totals.
 else if(screen.status==='title_review_needed')reason='Resolve reported lien or tax amounts before spending on a call.';
 return {status:reason?'hold' as const:'eligible' as const,checkedAt:input.checkedAt,reason:reason||'Preliminary numbers allow qualification; this is not offer approval or clear title.'};
}
