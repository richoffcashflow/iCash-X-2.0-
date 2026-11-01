import {costCategories} from './cost-guard.ts';
export type ProviderCostEvidence={provider:string;verifiedMicros:number;estimatedMicros:number;unclassifiedMicros:number};
export type OwnerCostEvidence={days:1|7|30;includeOwner:boolean;startAt:string;endAt:string;completedCount:number;missingManifestCount:number;mismatchedManifestCount:number;recordedCostMicros:number;verifiedMicros:number;estimatedMicros:number;unclassifiedMicros:number;dealmachineCredits:number;providers:ProviderCostEvidence[]};
const categories=new Set<string>(costCategories);
const nonnegative=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
export function validOwnerCostEvidence(value:unknown,filters:{days:number;includeOwner:boolean}):value is OwnerCostEvidence{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const v=value as OwnerCostEvidence;
 if(v.days!==filters.days||v.includeOwner!==filters.includeOwner||![v.startAt,v.endAt].every(t=>typeof t==='string'&&Number.isFinite(Date.parse(t)))||Date.parse(v.endAt)<Date.parse(v.startAt))return false;
 if(![v.completedCount,v.missingManifestCount,v.mismatchedManifestCount,v.recordedCostMicros,v.verifiedMicros,v.estimatedMicros,v.unclassifiedMicros,v.dealmachineCredits].every(nonnegative)||v.missingManifestCount+v.mismatchedManifestCount>v.completedCount)return false;
 if(!Array.isArray(v.providers)||v.providers.length>categories.size||new Set(v.providers.map(p=>p?.provider)).size!==v.providers.length)return false;
 if(!v.providers.every(p=>p&&categories.has(p.provider)&&[p.verifiedMicros,p.estimatedMicros,p.unclassifiedMicros].every(nonnegative)))return false;
 const total=v.verifiedMicros+v.estimatedMicros+v.unclassifiedMicros;
 if(!nonnegative(total)||v.missingManifestCount===0&&v.mismatchedManifestCount===0&&total!==v.recordedCostMicros)return false;
 return (['verifiedMicros','estimatedMicros','unclassifiedMicros'] as const).every(k=>v.providers.reduce((sum,p)=>sum+p[k],0)===v[k]);
}
export const costEvidenceLabels:Record<string,string>={dealmachine:'DealMachine',elevenlabs:'ElevenLabs',twilio:'Twilio',llm:'AI models',email:'Email',messaging:'Messaging',acquisition:'Acquisition allocation',payments:'Payment fees',support_and_overhead:'Support allocation',refund_and_dispute_reserve:'Refund reserve',railway:'Railway',supabase:'Supabase',vercel:'Vercel',github:'GitHub',title_and_signing:'Title and signing',other:'Other'};
