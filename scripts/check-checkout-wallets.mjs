import Stripe from 'stripe';

// Read-only production check. Never creates a checkout, payment, or customer.
// Only public domains and wallet readiness are logged; no provider responses or keys.
const production = process.env.VERCEL_ENV === 'production'
  && (!process.env.VERCEL_TARGET_ENV || process.env.VERCEL_TARGET_ENV === 'production')
  && process.env.VERCEL_GIT_COMMIT_REF === 'main';
const key = process.env.STRIPE_SECRET_KEY;
const domains = ['geticashx.com', 'www.geticashx.com', 'homeoffernetwork.com', 'www.homeoffernetwork.com'];
const wallet = (value) => ({
  available: value?.available === true,
  preference: ['on', 'off', 'none'].includes(value?.display_preference?.value)
    ? value.display_preference.value : 'unknown',
});
const status = (value) => ['active', 'inactive'].includes(value) ? value : 'unknown';

if (!production || !/^sk_live_/.test(key || '')) {
  console.log('Stripe checkout wallets: skipped outside trusted live production.');
} else {
  const stripe = new Stripe(key, {maxNetworkRetries: 1, timeout: 10000});
  const checks = await Promise.allSettled([
    (async () => {
      const configs = await stripe.paymentMethodConfigurations.list({limit: 100});
      const config = configs.data.find((item) => item.is_default && !item.application);
      return config ? {
        check: 'default_configuration', active: config.active, live: config.livemode,
        card: wallet(config.card), applePay: wallet(config.apple_pay), googlePay: wallet(config.google_pay),
      } : {check: 'default_configuration', status: 'not_found', moreConfigurations: configs.has_more};
    })(),
    ...domains.map(async (domain) => {
      const matches = await stripe.paymentMethodDomains.list({domain_name: domain, limit: 100});
      const found = matches.data.find((item) => item.domain_name === domain && item.livemode);
      return found ? {
        check: 'domain', domain, registered: true, enabled: found.enabled,
        applePay: status(found.apple_pay?.status), googlePay: status(found.google_pay?.status),
      } : {check: 'domain', domain, registered: false};
    }),
  ]);
  for (const [index, result] of checks.entries()) {
    const report = result.status === 'fulfilled' ? result.value : {
      check: index === 0 ? 'default_configuration' : 'domain',
      ...(index > 0 ? {domain: domains[index - 1]} : {}),
      status: 'check_failed',
      httpStatus: Number.isInteger(result.reason?.statusCode) ? result.reason.statusCode : null,
    };
    console.log(`Stripe checkout wallets: ${JSON.stringify(report)}`);
  }
}
