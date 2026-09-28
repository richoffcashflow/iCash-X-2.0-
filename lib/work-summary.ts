export type WorkSummary={generatedAt:string;scope:string;balanceCents:number;reservedCents:number;fundedCents:number;spentCents:number;analyzed:number;screeningCandidates:number;ownerRecords:number;contracts:number;activeContracts:number;closed:number;pending:number;reasons:{reason:string|null;count:number}[];lastPack:string|null};
export function summaryExplanation(s:WorkSummary){
 if(s.closed>0)return `${s.closed} funded closing(s) are recorded. See the remaining work below.`;
 if(s.activeContracts>0)return 'Signed contracts remain active. A closing and payment have not yet been recorded.';
 if(s.contracts>0)return 'A signed contract is recorded, but no funded closing is recorded.';
 if(s.screeningCandidates>0)return 'Some properties passed preliminary screening. This does not establish seller interest, an agreed offer, or a signed contract.';
 if(s.analyzed>0)return 'No analyzed property currently has a passing preliminary screening result. Recorded screening reasons are listed below.';
 return 'No completed property analysis or funded closing is recorded. These records cannot establish why a deal did not close.';
}
export function summaryLines(s:WorkSummary){return [
 s.scope,`Generated: ${s.generatedAt}`,`Confirmed funding: $${(s.fundedCents/100).toFixed(2)}`,`Settled usage charges: $${(s.spentCents/100).toFixed(2)}`,`Available: $${((s.balanceCents-s.reservedCents)/100).toFixed(2)} | Reserved: $${(s.reservedCents/100).toFixed(2)}`,
 '',`Properties analyzed: ${s.analyzed}`,`Preliminary screening candidates: ${s.screeningCandidates}`,`Properties with owner information: ${s.ownerRecords}`,`Signed contracts recorded: ${s.contracts}`,`Active signed contracts: ${s.activeContracts}`,`Funded closings recorded: ${s.closed}`,`Pending operations: ${s.pending}`,
 '', 'WHAT THE RECORDS SHOW',summaryExplanation(s),...s.reasons.map(r=>`${r.count} screening result(s): ${r.reason||'No detailed reason recorded.'}`),
 '', 'WHAT REMAINS',s.activeContracts>0?'Active contracts still need verified closing coordination.':s.screeningCandidates>0?'Candidates still need authorized contact, seller qualification and agreement.':'Further research or review may be needed. Review screening reasons before funding more work.',
 s.pending>0?'Some operations are pending. Final charges and outcomes may change after reconciliation.':'No pending paid operations are recorded.',
 '', 'This is an all-time account summary, not a report for one credit purchase.','Missing records are not proof that an event never occurred. No cause of failure is inferred.','Adding credits does not guarantee a contract, closing or income. No automatic charge is made.'
 ];}
