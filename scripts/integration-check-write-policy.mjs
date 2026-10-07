/** These rows are keyed by provider, not deployment. Preview build diagnostics
 * must never replace shared production evidence, including with missing config.
 * Explicit local diagnostics retain their existing behavior.
 */
export function canSaveSharedIntegrationCheck(env=process.env){
 const vercel=env.VERCEL==='1'||Boolean(env.VERCEL_ENV)||Boolean(env.VERCEL_TARGET_ENV);
 return !vercel||(env.VERCEL_ENV==='production'&&(!env.VERCEL_TARGET_ENV||env.VERCEL_TARGET_ENV==='production'));
}
