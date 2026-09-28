/** Live inputs must come from a trusted server account snapshot. Never use demo events as live evidence. */
export type ConversionContext =
  | { mode: "demo"; complete: boolean }
  | { mode: "live"; verified: boolean; pausedForCredits: boolean; balanceCents: number; nextChargeCents: number; activeOpportunities: number };
export type ConversionOffer = { title: string; detail: string; button: string; reason: "preview_complete" | "credits_required" };
export function conversionOffer(context: ConversionContext, pack: { amountCents: number; label: string }): ConversionOffer | null {
  if (!Number.isSafeInteger(pack.amountCents) || pack.amountCents <= 0) throw new Error("Invalid credit pack");
  if (context.mode === "demo") return context.complete ? {
    title: "Free preview complete.",
    detail: "You've seen the steps. Credits fund real research and permitted outreach when live access opens.",
    button: `Fund my bot — ${pack.label}`, reason: "preview_complete",
  } : null;
  if (![context.balanceCents, context.nextChargeCents, context.activeOpportunities].every(value=>Number.isSafeInteger(value) && value>=0)) return null;
  if (!context.verified || !context.pausedForCredits || context.nextChargeCents <= context.balanceCents) return null;
  return { title: "Your bot needs credits to continue.", detail: context.activeOpportunities > 0
    ? `${context.activeOpportunities} active ${context.activeOpportunities === 1 ? "opportunity" : "opportunities"}. Add credits for the next eligible work; a closing is not guaranteed.`
    : "Add credits to resume eligible work within your daily limit.", button: `Add ${pack.label} in credits`, reason: "credits_required" };
}
