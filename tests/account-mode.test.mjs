import assert from 'node:assert/strict';
import {accountMode} from '../lib/account-mode.ts';
assert.equal(accountMode({VERCEL_ENV:'production'}),'live');
assert.equal(accountMode({VERCEL_ENV:'preview',STRIPE_SECRET_KEY:'sk_live_wrong'}),'test');
assert.equal(accountMode({VERCEL_ENV:'production',STRIPE_SECRET_KEY:'sk_test_wrong'}),'live');
assert.equal(accountMode({}),null);
console.log('Sign-in stays independent of Stripe secrets and preserves account environment separation.');
