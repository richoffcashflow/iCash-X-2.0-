import assert from 'node:assert/strict';
import {checkoutDomains, prepareCheckoutWallets} from '../scripts/prepare-checkout-wallets.mjs';

const env = {VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main', STRIPE_SECRET_KEY: 'sk_live_mock'};
const unavailable = () => {throw Error('Stripe must not be accessed');};
assert.equal((await prepareCheckoutWallets(env, false, unavailable)).status, 'not_requested');
for (const override of [{VERCEL_ENV: 'preview'}, {VERCEL_TARGET_ENV: 'preview'}, {VERCEL_GIT_COMMIT_REF: 'feature'}]) {
  assert.equal((await prepareCheckoutWallets({...env, ...override}, true, unavailable)).status, 'not_requested');
}
await assert.rejects(prepareCheckoutWallets({...env, STRIPE_SECRET_KEY: 'sk_test_mock'}, true, unavailable), /LIVE_STRIPE_REQUIRED/);

const entries = new Map();
const writes = [];
const stripe = {paymentMethodDomains: {
  list: async ({domain_name}) => ({data: [...entries.values()].filter((item) => item.domain_name === domain_name), has_more: false}),
  create: async (params, options) => {
    assert.deepEqual(params, {domain_name: params.domain_name, enabled: true});
    assert(checkoutDomains.includes(params.domain_name));
    assert(options.idempotencyKey.includes(params.domain_name));
    writes.push(['create', params.domain_name]);
    const item = {id: `pmd_${entries.size}`, ...params, livemode: true, apple_pay: {status: 'active'}, google_pay: {status: 'active'}};
    entries.set(item.id, item);
    return item;
  },
  update: async (id, params) => {
    assert.deepEqual(params, {enabled: true});
    writes.push(['update', id]);
    Object.assign(entries.get(id), params);
    return entries.get(id);
  },
  validate: async (id) => {
    writes.push(['validate', id]);
    const item = entries.get(id);
    item.apple_pay.status = 'active';
    item.google_pay.status = 'active';
    return item;
  },
  retrieve: async (id) => entries.get(id),
}};
const factory = () => stripe;
const ready = await prepareCheckoutWallets(env, true, factory);
assert.equal(ready.status, 'ready');
assert.deepEqual(writes, checkoutDomains.map((domain) => ['create', domain]));
assert.equal(ready.domains.length, checkoutDomains.length);
writes.length = 0;
await prepareCheckoutWallets(env, true, factory);
assert.deepEqual(writes, []); // Repeated production deploys make no changes.

const first = entries.get('pmd_0');
first.enabled = false;
first.apple_pay.status = 'inactive';
await prepareCheckoutWallets(env, true, factory);
assert.deepEqual(writes, [['update', 'pmd_0'], ['validate', 'pmd_0']]);

const badReadback = {paymentMethodDomains: {...stripe.paymentMethodDomains,
  retrieve: async (id) => ({...entries.get(id), enabled: false})}};
await assert.rejects(prepareCheckoutWallets(env, true, () => badReadback), /DOMAIN_WALLETS_NOT_READY/);
const incomplete = {paymentMethodDomains: {list: async () => ({data: [], has_more: true})}};
await assert.rejects(prepareCheckoutWallets(env, true, () => incomplete), /DOMAIN_LIST_INCOMPLETE/);
console.log('Checkout wallet registration: production guard, fixed domains, repeat deploy, activation, and readback checks passed.');
