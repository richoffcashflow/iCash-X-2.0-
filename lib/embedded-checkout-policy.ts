import type Stripe from 'stripe';

/** A key from another Stripe mode must never initialize a payment form. */
export function checkoutPublishableKey(mode:'live'|'test'|null,env:NodeJS.ProcessEnv=process.env){
 const key=env.STRIPE_PUBLISHABLE_KEY||env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
 return mode&&key&&new RegExp(`^pk_${mode}_[A-Za-z0-9]+$`).test(key)?key:null;
}
export function membershipCheckoutPresentation(embedded:boolean,origin:string):Partial<Stripe.Checkout.SessionCreateParams>{
 return embedded?{ui_mode:'embedded_page',redirect_on_completion:'never'}:{success_url:`${origin}/join?membership=paid&session_id={CHECKOUT_SESSION_ID}`,cancel_url:`${origin}/join?membership=cancelled`};
}
export function checkoutMatchesPresentation(session:Pick<Stripe.Checkout.Session,'ui_mode'|'url'|'client_secret'>,embedded:boolean){
 return embedded?session.ui_mode==='embedded_page'&&!!session.client_secret:(!session.ui_mode||session.ui_mode==='hosted_page')&&!!session.url;
}

export function fundingCheckoutPresentation(embedded:boolean,origin:string):Partial<Stripe.Checkout.SessionCreateParams>{
 return embedded?{ui_mode:'embedded_page',redirect_on_completion:'never'}:{success_url:`${origin}/?payment=funded&session_id={CHECKOUT_SESSION_ID}#funding`,cancel_url:`${origin}/?payment=canceled#funding`};
}
