/** Conservative issuer-aware retries. Unknown and hard declines require customer action. */
export type PaymentFailureKind='temporary'|'authentication'|'payment_method';
const temporary=new Set(['insufficient_funds','issuer_not_available','processing_error','try_again_later','reenter_transaction']);
const neverRetry=new Set(['do_not_try_again','revocation_of_authorization','revocation_of_all_authorizations','lost_card','stolen_card','pickup_card','restricted_card','transaction_not_allowed','highest_risk_level']);
export function paymentFailureKind(payment:{status?:string;last_payment_error?:{code?:string;decline_code?:string;advice_code?:string|null}|null}):PaymentFailureKind{
 const error=payment.last_payment_error;
 if(neverRetry.has(error?.advice_code??'')||neverRetry.has(error?.decline_code??''))return 'payment_method';
 if(payment.status==='requires_action'||error?.code==='authentication_required'||error?.decline_code==='authentication_required')return 'authentication';
 return temporary.has(error?.decline_code??error?.code??'')?'temporary':'payment_method';
}
export function recoveryStep(channel:'email'|'sms',startedAt:string,now=Date.now()){
 const age=now-Date.parse(startedAt);
 if(!Number.isFinite(age)||age<0||age>=14*86400000)return null;
 if(channel==='sms')return age>=86400000?0:null;
 return age>=13*86400000?3:age>=7*86400000?2:age>=3*86400000?1:0;
}
export function recoveryCopy(kind:'membership'|'private_vip'|'recharge',amount:number,step:number,link:string){
 if(!Number.isSafeInteger(amount)||amount<=0||amount>1000000)throw Error('Invalid recovery amount');
 const price=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(amount/100);
 const recharge=kind==='recharge',product=recharge?'credit refill':kind==='private_vip'?'VIP renewal':'subscription renewal';
 return {subject:step===0?`Your iCash X ${product} needs attention`:`Your iCash X ${product} is still unpaid`,
 text:`Hey,\n\nYour ${price} iCash X ${product} didn’t go through.${recharge?' Your balance has not been credited for this failed payment.':' Complete your existing renewal to restore subscription access.'}\n\n${recharge?'Open Add money, choose your credit amount and enable auto recharge if you want automatic refills to continue. Complete payment with your preferred card.':'Use this secure link to complete the existing invoice or update your payment method.'}\n${link}\n\n${recharge?'Your saved recharge amount and limits still apply.':'This is your existing subscription renewal; you do not need to buy another subscription.'}\n\nNeed help? Reply to this email.\n— iCash X Support`,
 sms:`iCash X: Your ${product} needs attention. Check your billing email or sign in at https://www.geticashx.com/access for payment help. Reply STOP to opt out.`};
}
