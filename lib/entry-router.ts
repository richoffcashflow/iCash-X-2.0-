/** Server-side post-auth destination. Never infer account identity from ad parameters. */
export type AccountSnapshot = {
  authenticated: boolean;
  setupComplete: boolean;
  balanceCents: number;
  paused: boolean;
  activeOpportunities: number;
  needsUserAction: boolean;
  nextActionUrl?: string;
  lowCreditThresholdCents: number;
};
export type Destination = { path: string; reason: "new" | "finish_setup" | "needs_you" | "fund" | "resume" | "working" };
export function nextDestination(account: AccountSnapshot): Destination {
  if (!account.authenticated) return { path: "/", reason: "new" };
  if (!account.setupComplete) return { path: "/", reason: "finish_setup" };
  if (account.needsUserAction && account.nextActionUrl?.startsWith("/opportunities/") && !account.nextActionUrl.includes("//")) return { path: account.nextActionUrl, reason: "needs_you" };
  if (account.balanceCents <= 0 || account.balanceCents <= account.lowCreditThresholdCents && account.activeOpportunities > 0) return { path: "/credits", reason: "fund" };
  if (account.paused) return { path: "/?resume=1", reason: "resume" };
  return { path: "/activity", reason: "working" };
}
