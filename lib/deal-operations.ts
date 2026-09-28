export type DealSnapshot = {
  sellerSigned: boolean; marketingAuthorized: boolean; buyerSigned: boolean; depositConfirmedByEscrow: boolean;
  titleOpened: boolean; closingScheduled: boolean; closedByTitle: boolean; proceedsConfirmed: boolean;
  failed: boolean; buyerWithdrew: boolean; titleIssue: boolean; deadlineAt: number | null;
};
export function dealProgress(s: DealSnapshot, now: number) {
  const stage = s.failed ? "stopped" : !s.sellerSigned ? "seller" : s.closedByTitle ? "closed" : s.buyerWithdrew ? "finding_buyer" : s.closingScheduled && s.titleOpened && s.buyerSigned && s.depositConfirmedByEscrow ? "closing" : s.buyerSigned && s.depositConfirmedByEscrow ? "buyer_committed" : "finding_buyer";
  const attention = s.failed || s.closedByTitle ? null : s.titleIssue ? "Title needs a decision. Review the issue before proceeding." : s.buyerWithdrew ? "Buyer withdrew. Review the backup buyer plan." : s.deadlineAt!==null && Number.isFinite(s.deadlineAt) && s.deadlineAt-now<=48*3600000 ? (s.deadlineAt<now ? "A contract deadline has passed. Review it now." : "A contract deadline is approaching. Review the next step.") : null;
  const next = stage === "stopped" ? "Review why the deal stopped." : stage === "closed" ? (s.proceedsConfirmed ? "View the confirmed closing statement." : "Await confirmation of proceeds; no payout is assumed.") : !s.sellerSigned ? "Confirm the seller agreement." : s.buyerWithdrew ? "Review backups before contacting another buyer." : !s.marketingAuthorized ? "Confirm permission to market the deal." : !s.buyerSigned ? "Match buyers and agree on terms." : !s.depositConfirmedByEscrow ? "Await deposit confirmation from escrow." : !s.titleOpened ? "Confirm the title file is open." : !s.closingScheduled ? "Coordinate the closing date." : "Complete closing requirements with title.";
  return {stage,attention,next,pinned:s.sellerSigned && !s.failed && !s.closedByTitle,history:s.failed||s.closedByTitle};
}
/** A worker must obtain this lease atomically in shared storage immediately before dispatch. */
export function contactDispatchAllowed(s: { permitted:boolean; suppressed:boolean; botPaused:boolean; humanOwnsConversation:boolean; exclusiveContactLease:boolean; duplicateOperation:boolean }) {
  return s.permitted && !s.suppressed && !s.botPaused && !s.humanOwnsConversation && s.exclusiveContactLease && !s.duplicateOperation;
}
