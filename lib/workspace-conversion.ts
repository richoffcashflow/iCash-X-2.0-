/** Recommendations describe verified work; they never authorize spending. */
export type WorkspaceConversionInput = {
  balanceCents: number;
  paused: boolean;
  billingReview: boolean;
  identityReady: boolean;
  membershipActive: boolean;
  canFund: boolean;
  autoRechargeEnabled: boolean;
  recentPurchase: boolean;
  queuedResearch: number;
  completedResearch: number;
  vipAvailable: boolean;
  vip: boolean;
};
export type WorkspaceConversionOffer = {
  key: string;
  action: 'funding' | 'resume' | 'vip';
  title: string;
  detail: string;
  compact: string;
  button: string;
  amountCents?: number;
};
export function workspaceConversionOffer(input: WorkspaceConversionInput): WorkspaceConversionOffer | null {
  if (![input.balanceCents, input.queuedResearch, input.completedResearch].every(n => Number.isSafeInteger(n) && n >= 0)) return null;
  if (input.billingReview || !input.membershipActive || !input.identityReady) return null;
  const empty = input.balanceCents === 0;
  const low = input.balanceCents < 500;
  if ((empty || low) && input.canFund && !input.autoRechargeEnabled) {
    const amountCents = 2500;
    const research = input.queuedResearch > 0;
    const continuing = research || input.completedResearch > 0;
    return {
      key: `funding:${empty ? 'empty' : 'low'}:${research ? 'research' : continuing ? 'continue' : 'start'}`,
      action: 'funding', amountCents,
      title: research ? 'Your property research is queued.' : empty ? continuing ? 'Let’s keep your bot working.' : 'Put your bot to work.' : 'Keep your bot funded.',
      detail: research
        ? 'I have property research in the queue. Add $25 in credits for property data, owner lookups, and eligible AI work.'
        : continuing
          ? 'Your research is saved. Add $25 in credits for the next property searches, owner lookups, and eligible follow-ups.'
          : 'Add $25 in credits for property searches, owner lookups, and eligible AI work.',
      compact: research ? 'Research queued' : empty ? 'Your bot needs credits' : 'Credits running low',
      button: continuing ? 'Add $25 & continue' : 'Add $25 & start',
    };
  }
  if (empty) return null;
  if (input.paused) return {
    key: 'resume', action: 'resume', title: 'Your credits are ready to work.',
    detail: 'Start your bot to continue eligible research and outreach within your spending settings.',
    compact: 'Your bot is paused', button: 'Run my bot',
  };
  if (input.vipAvailable && !input.vip && !input.recentPurchase) return {
    key: 'vip', action: 'vip', title: 'Make your credits go further.',
    detail: 'VIP gives you 20% off AI work and lead costs, plus priority for eligible new leads.',
    compact: 'Save on AI work with VIP', button: 'View my upgrade',
  };
  return null;
}
