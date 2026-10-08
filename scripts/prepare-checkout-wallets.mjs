import Stripe from 'stripe';
import {pathToFileURL} from 'node:url';

// Owner-requested wallet registration for the existing production checkout hosts.
// No checkout sessions, customers, payment methods, or charges are created.
export const checkoutDomains = Object.freeze([
  'geticashx.com', 'www.geticashx.com', 'homeoffernetwork.com', 'www.homeoffernetwork.com',
]);

export async function prepareCheckoutWallets(env = process.env, register = false, createStripe =
  (key) => new Stripe(key, {maxNetworkRetries: 2, timeout: 10000})) {
  const production = env.VERCEL_ENV === 'production'
    && (!env.VERCEL_TARGET_ENV || env.VERCEL_TARGET_ENV === 'production')
    && env.VERCEL_GIT_COMMIT_REF === 'main';
  if (!register || !production) return {status: 'not_requested'};
  if (!/^sk_live_/.test(env.STRIPE_SECRET_KEY || '')) throw Error('LIVE_STRIPE_REQUIRED');
  const stripe = createStripe(env.STRIPE_SECRET_KEY);
  const reports = [];
  for (const domain of checkoutDomains) {
    const listed = await stripe.paymentMethodDomains.list({domain_name: domain, limit: 100});
    if (listed.has_more) throw Error('DOMAIN_LIST_INCOMPLETE');
    const matches = listed.data.filter((item) => item.domain_name === domain && item.livemode);
    if (matches.length > 1) throw Error('DOMAIN_NOT_UNIQUE');
    let entry = matches[0];
    if (!entry) {
      entry = await stripe.paymentMethodDomains.create({domain_name: domain, enabled: true},
        {idempotencyKey: `icash-checkout-domain-v1:${domain}`});
    } else if (!entry.enabled) {
      entry = await stripe.paymentMethodDomains.update(entry.id, {enabled: true});
    }
    if (entry.domain_name !== domain || !entry.livemode) throw Error('DOMAIN_IDENTITY_MISMATCH');
    if (entry.apple_pay?.status !== 'active' || entry.google_pay?.status !== 'active') {
      await stripe.paymentMethodDomains.validate(entry.id);
    }
    const verified = await stripe.paymentMethodDomains.retrieve(entry.id);
    if (verified.domain_name !== domain || !verified.livemode || !verified.enabled
      || verified.apple_pay?.status !== 'active' || verified.google_pay?.status !== 'active') {
      throw Error('DOMAIN_WALLETS_NOT_READY');
    }
    reports.push({domain, applePay: 'active', googlePay: 'active'});
  }
  return {status: 'ready', domains: reports};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log('Stripe wallet registration:', JSON.stringify(await prepareCheckoutWallets(
      process.env, process.argv.includes('--register-production-domains'))));
  } catch (error) {
    const known = ['LIVE_STRIPE_REQUIRED', 'DOMAIN_LIST_INCOMPLETE', 'DOMAIN_NOT_UNIQUE',
      'DOMAIN_IDENTITY_MISMATCH', 'DOMAIN_WALLETS_NOT_READY'];
    console.error('Stripe wallet registration failed:', known.includes(error?.message) ? error.message : 'PROVIDER_CHECK_FAILED');
    process.exitCode = 1;
  }
}
