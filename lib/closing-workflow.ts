/** Closing-side workflow gates. This does not sign, send, collect, or disburse money. */
export type ClosingStage = "seller_interest" | "seller_contract_draft" | "seller_contract_signed" | "buyer_matching" | "buyer_terms_review" | "buyer_agreement_signed" | "title_opened" | "deposit_instructions_sent" | "deposit_confirmed" | "closing_scheduled" | "closed";
export type ClosingEvent = "draft_seller_contract" | "seller_signed" | "start_buyer_matching" | "buyer_selected" | "buyer_signed" | "title_confirmed" | "send_deposit_instructions" | "escrow_confirmed_deposit" | "schedule_closing" | "confirm_closed";
export type ClosingContext = {
  outreachPaused: boolean;
  sellerAgreementApproved: boolean;
  sellerContractSigned: boolean;
  buyerAgreementApproved: boolean;
  buyerAgreementSigned: boolean;
  buyerClosingCostsInSignedTerms: boolean;
  depositTermsInSignedAgreement: boolean;
  escrowAgentVerified: boolean;
  titleInstructionsVerified: boolean;
  paymentLinkFromEscrow: boolean;
  depositConfirmedByEscrow: boolean;
  closeConfirmedByTitle: boolean;
};
const steps: Record<ClosingEvent, { from: ClosingStage; to: ClosingStage; required?: (keyof ClosingContext)[]; outbound?: boolean }> = {
  draft_seller_contract: { from: "seller_interest", to: "seller_contract_draft", required: ["sellerAgreementApproved"] },
  seller_signed: { from: "seller_contract_draft", to: "seller_contract_signed", required: ["sellerContractSigned"] },
  start_buyer_matching: { from: "seller_contract_signed", to: "buyer_matching", outbound: true },
  buyer_selected: { from: "buyer_matching", to: "buyer_terms_review", outbound: true },
  buyer_signed: { from: "buyer_terms_review", to: "buyer_agreement_signed", required: ["buyerAgreementApproved", "buyerAgreementSigned", "buyerClosingCostsInSignedTerms"] },
  title_confirmed: { from: "buyer_agreement_signed", to: "title_opened", required: ["escrowAgentVerified", "titleInstructionsVerified"] },
  send_deposit_instructions: { from: "title_opened", to: "deposit_instructions_sent", required: ["depositTermsInSignedAgreement", "escrowAgentVerified", "titleInstructionsVerified", "paymentLinkFromEscrow"], outbound: true },
  escrow_confirmed_deposit: { from: "deposit_instructions_sent", to: "deposit_confirmed", required: ["depositConfirmedByEscrow"] },
  schedule_closing: { from: "deposit_confirmed", to: "closing_scheduled", required: ["titleInstructionsVerified"] },
  confirm_closed: { from: "closing_scheduled", to: "closed", required: ["closeConfirmedByTitle"] },
};
export function nextClosingStage(stage: ClosingStage, event: ClosingEvent, context: ClosingContext): ClosingStage {
  const step = steps[event];
  if (stage !== step.from) throw new Error(`Cannot ${event} from ${stage}`);
  if (context.outreachPaused && step.outbound) throw new Error("Outreach is paused");
  for (const requirement of step.required ?? []) if (!context[requirement]) throw new Error(`Missing verified condition: ${requirement}`);
  return step.to;
}
