export type ContractTemplateCapability={template_scope?:'state'|'standard';state_code:string;kind:string;signer_count:number;enabled:boolean;test_mode:boolean;provider:string;reviewed_until:string;rate:{operation:string;enabled:boolean;expires_at:string}|null};
export type ContractCoverage={states:{state:string;signerCounts:number[]}[];standardSignerCounts?:number[];scope:'configured_templates'};
/** Software availability only. Standard forms do not claim state-specific or counsel review. */
export function reviewedContractCoverage(templates:ContractTemplateCapability[],now=Date.now()):ContractCoverage{
 const counts=new Map<string,Map<number,Set<string>>>();
 for(const t of templates){
  if((t.template_scope!==undefined&&!['state','standard'].includes(t.template_scope))||!/^[A-Z]{2}$/.test(t.state_code)||!['purchase','assignment'].includes(t.kind)||!Number.isInteger(t.signer_count)||t.signer_count<1||t.signer_count>8||!t.enabled||t.test_mode||t.provider!=='docuseal'||!(Date.parse(t.reviewed_until)>now)||!t.rate?.enabled||t.rate.operation!=='contract_signing'||!(Date.parse(t.rate.expires_at)>now))continue;
  const key=t.template_scope==='standard'?'standard':t.state_code;
  const state=counts.get(key)??new Map<number,Set<string>>();const kinds=state.get(t.signer_count)??new Set<string>();kinds.add(t.kind);state.set(t.signer_count,kinds);counts.set(key,state);
 }
 const standard=counts.get('standard')??new Map<number,Set<string>>();
 const complete=(state:Map<number,Set<string>>)=>[...new Set([...state.keys(),...standard.keys()])].filter(count=>{
  const kinds=new Set([...(standard.get(count)??[]),...(state.get(count)??[])]);return kinds.has('purchase')&&kinds.has('assignment');
 }).sort((a,b)=>a-b);
 return {scope:'configured_templates',standardSignerCounts:complete(standard),states:[...counts].filter(([state])=>state!=='standard').map(([state,signers])=>({state,signerCounts:complete(signers)})).filter(s=>s.signerCounts.length).sort((a,b)=>a.state.localeCompare(b.state))};
}
export function contractCapability(coverage:ContractCoverage,state:string|null,signers=1){
 const validState=!!state&&/^[A-Z]{2}$/.test(state.toUpperCase());
 const standard=coverage.standardSignerCounts?.includes(signers)===true;
 const supported=validState&&(standard||coverage.states.some(s=>s.state===state!.toUpperCase()&&s.signerCounts.includes(signers)));
 return {supported,reason:supported?(standard?'Standard purchase and assignment forms are available. You are responsible for choosing and reviewing the agreement.':'Configured purchase and assignment forms are available. You are responsible for choosing and reviewing the agreement.'):!validState?'Enter the property state before contract work.':`A purchase and assignment template supporting all ${signers} required ${signers===1?'counterparty signer is':'counterparty signers are'} not configured. Add a matching template without leaving out any required party.`};
}
