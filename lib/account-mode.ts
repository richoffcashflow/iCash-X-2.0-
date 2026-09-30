/** Account access is independent of Stripe credentials; balances stay environment-isolated. */
export function accountMode(env:NodeJS.ProcessEnv=process.env):'live'|'test'|null{
 return env.VERCEL_ENV==='production'?'live':env.VERCEL_ENV==='preview'?'test':null;
}
