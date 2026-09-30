export type ContractTemplateCapability={state_code:string;kind:string;signer_count:number;enabled:boolean;test_mode:boolean;provider:string;reviewed_until:string;rate:{operation:string;enabled:boolean;expires_at:string}|null};
export type ContractCoverage={states:{state:string;signerCounts:number[]}[];scope:'reviewed_templates'};
/** Template availability is not legal permission, contact consent or a signed agreement. */
export function reviewedContractCoverage(templates:ContractTemplateCapability[],now=Date.now()):ContractCoverage{
 const counts=new Map<string,Map<number,Set<string>>>();
 for(const t of templates){
  if(!/^[A-Z]{2}$/.test(t.state_code)||!['purchase','assignment'].includes(t.kind)||!Number.isInteger(t.signer_count)||t.signer_count<1||t.signer_count>8||!t.enabled||t.test_mode||t.provider!=='docuseal'||!(Date.parse(t.reviewed_until)>now)||!t.rate?.enabled||t.rate.operation!=='contract_signing'||!(Date.parse(t.rate.expires_at)>now))continue;
  const state=counts.get(t.state_code)??new Map<number,Set<string>>();const kinds=state.get(t.signer_count)??new Set<string>();kinds.add(t.kind);state.set(t.signer_count,kinds);counts.set(t.state_code,state);
 }
 return {scope:'reviewed_templates',states:[...counts].map(([state,signers])=>({state,signerCounts:[...signers].filter(([,kinds])=>kinds.has('purchase')&&kinds.has('assignment')).map(([count])=>count).sort((a,b)=>a-b)})).filter(s=>s.signerCounts.length).sort((a,b)=>a.state.localeCompare(b.state))};
}
export function contractCapability(coverage:ContractCoverage,state:string|null,signers=1){
 const supported=!!state&&coverage.states.some(s=>s.state===state.toUpperCase()&&s.signerCounts.includes(signers));
 return {supported,reason:supported?'Reviewed agreement templates are available for this state and signer count. Ownership, local requirements and the exact agreement still need review.':!state?'Research only: the property state must be verified before contract work.':`Research only: reviewed purchase and assignment templates are unavailable for ${state.toUpperCase()} with ${signers} required ${signers===1?'signer':'signers'}. A qualified reviewer must add the correct documents before acquisition can proceed.`};
}
