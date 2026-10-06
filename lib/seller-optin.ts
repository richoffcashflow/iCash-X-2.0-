export const sellerOptinExperiment = 'homeoffer-optin-v1';
export const sellerOptinVariants = [
  {id: 'fast_cash', label: 'Fast cash', accent: 'Fast Cash', headline: 'For Your Home.', description: 'Request a cash offer. Sell as-is.\nMove on your terms.', cta: 'Get My Cash Offer'},
  {id: 'as_is', label: 'Sell as-is', accent: 'Your Home.', headline: 'Cash. As-Is.', description: 'Skip the repairs. Explore a cash offer.\nYou choose what comes next.', cta: 'See My Cash Options'},
  {id: 'ready', label: 'Ready to sell', accent: 'Ready to Sell?', headline: 'Let’s Talk Cash.', description: 'Connect with cash buyers for your home.\nNo obligation to accept.', cta: 'Request My Cash Offer'},
] as const;
export type SellerOptinVariant = typeof sellerOptinVariants[number]['id'];
export type SellerOptinRow = {variant: SellerOptinVariant; source: string; device: string; views: number; starts: number; contacts: number; submissions: number; qualified: number; matureViews: number; matureQualified: number};
export type SellerOptinPlan = {mode: 'learning' | 'optimizing'; winner: SellerOptinVariant | null; weights: Record<SellerOptinVariant, number>};

export function sellerOptinCopy(id: string) {
  return sellerOptinVariants.find(variant => variant.id === id) || sellerOptinVariants[0];
}
export function sellerOptinSource(raw: string | null) {
  const source = raw?.toLowerCase();
  return source === 'facebook' || source === 'instagram' ? 'meta' : ['meta','google','youtube','tiktok','other'].includes(source || '') ? source! : 'direct';
}
export function sellerOptinCampaign(raw: string | null) {return (raw || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);}

// Conservative routing heuristic, not a declaration of statistical significance.
// Only daily, fully matured cohorts from the same source/device are compared.
function interval(successes: number, total: number) {
  const z = 2.576, p = successes / total, z2 = z*z;
  const center = (p + z2/(2*total))/(1 + z2/total);
  const margin = z*Math.sqrt(p*(1-p)/total + z2/(4*total*total))/(1 + z2/total);
  return {low: center-margin, high: center+margin};
}
export function sellerOptinPlan(rows: SellerOptinRow[]): SellerOptinPlan {
  const weights = {fast_cash: 1/3, as_is: 1/3, ready: 1/3};
  const learning: SellerOptinPlan = {mode: 'learning', winner: null, weights};
  const samples = sellerOptinVariants.map(v => rows.find(r => r.variant === v.id));
  if (samples.some(r => !r || !Number.isFinite(r.matureViews) || r.matureViews < 100 || !Number.isFinite(r.matureQualified) || r.matureQualified < 0 || r.matureQualified > r.matureViews)) return learning;
  const ranked = (samples as SellerOptinRow[]).map(r => ({...r, ...interval(r.matureQualified, r.matureViews)})).sort((a,b) => b.low-a.low);
  const best = ranked[0];
  if (best.matureQualified < 10 || ranked.slice(1).some(r => best.low <= r.high)) return learning;
  return {mode: 'optimizing', winner: best.variant, weights: {...{fast_cash: .1, as_is: .1, ready: .1}, [best.variant]: .8}};
}
export function chooseSellerOptin(plan: SellerOptinPlan, random: number): SellerOptinVariant {
  let remaining = Math.max(0, Math.min(.999999999, random));
  for (const variant of sellerOptinVariants) {
    remaining -= plan.weights[variant.id];
    if (remaining < 0) return variant.id;
  }
  return 'ready';
}
