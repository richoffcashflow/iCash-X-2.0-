import type Stripe from 'stripe';

type Plan={id:string;mode:'test'|'live';consent_version?:string;consent_text?:string};
export type DailyCheckoutQuote={plan_id:string;pack_code:string;budget_cents:number;credit_cents:number;fee_cents:number;budget_price:string;consent_text:string};
type Choice={packCode:string;budgetCents:number;creditCents:number;feeCents:number;consentVersion:string;consentText:string};

/** Reusing a checkout must preserve the exact purchase the customer just accepted. */
export function dailyCheckoutMatches(session:Stripe.Checkout.Session,plan:Plan,quote:DailyCheckoutQuote|undefined,choice:Choice){
 const items=session.line_items,line=items?.data[0];
 return !!quote&&session.status==='open'&&session.mode==='subscription'&&session.currency==='usd'&&
  session.livemode===(plan.mode==='live')&&session.metadata?.icash_daily_plan===plan.id&&
  session.amount_total===choice.budgetCents+choice.feeCents&&
  plan.consent_version===choice.consentVersion&&plan.consent_text===choice.consentText&&
  quote.plan_id===plan.id&&quote.pack_code===choice.packCode&&quote.budget_cents===choice.budgetCents&&
  quote.credit_cents===choice.creditCents&&quote.fee_cents===choice.feeCents&&quote.consent_text===choice.consentText&&
  !!items&&!items.has_more&&items.data.length===1&&line?.quantity===1&&
  line.price?.id===quote.budget_price&&line.currency==='usd'&&line.amount_total===session.amount_total&&
  line.price?.recurring?.interval==='day'&&line.price.recurring.interval_count===1;
}
