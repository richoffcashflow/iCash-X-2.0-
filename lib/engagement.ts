/** Notifications are derived only from persisted provider/title events. */
export type VerifiedMilestone = {
  id: string;
  kind: "seller_interested" | "contract_signed" | "buyer_interested" | "title_opened" | "deposit_confirmed" | "closing_scheduled" | "closed";
  opportunityId: string;
  verifiedAt: number;
  source: "provider_webhook" | "title_confirmation" | "signed_document";
};
export function milestoneMessage(event: VerifiedMilestone) {
  if (!event.id || !event.opportunityId || !Number.isFinite(event.verifiedAt)) throw new Error("Unverified milestone");
  const messages = {
    seller_interested: { title: "Seller interested", detail: "A real conversation moved this opportunity forward." },
    contract_signed: { title: "Deal under contract", detail: "The signed agreement is ready to view." },
    buyer_interested: { title: "Buyer interested", detail: "Buyer terms are being reviewed." },
    title_opened: { title: "Title opened", detail: "The closing team has the file." },
    deposit_confirmed: { title: "Deposit confirmed", detail: "Escrow confirmed receipt." },
    closing_scheduled: { title: "Closing scheduled", detail: "Your closing date is on the calendar." },
    closed: { title: "Deal closed", detail: "Title confirmed the closing. Review the final statement for your proceeds." },
  } as const;
  return messages[event.kind];
}
export type CreditPromptInput = { balanceCents: number; nextRequiredChargeCents: number; activeOpportunities: number; pausedForCredits: boolean };
export function creditPrompt(input: CreditPromptInput) {
  if (!input.pausedForCredits || input.activeOpportunities < 1 || input.balanceCents >= input.nextRequiredChargeCents || input.nextRequiredChargeCents <= 0) return null;
  return { title: "Keep this opportunity moving", detail: `${input.activeOpportunities} active ${input.activeOpportunities === 1 ? "opportunity needs" : "opportunities need"} a funded next step.`, minimumTopUpCents: Math.max(2000, input.nextRequiredChargeCents - input.balanceCents) };
}
