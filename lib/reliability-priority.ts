import type {ReliabilityReport} from './reliability.ts';
export const reliabilitySeverities=['minor','high','critical'] as const;
export type ReliabilitySeverity=typeof reliabilitySeverities[number];
export const reliabilitySeverityLabels={minor:'Minor',high:'High',critical:'Critical'};
export const reliabilitySeverityGuidance={
 minor:'An isolated workflow is delayed. Core background checks are healthy; recovery can continue.',
 high:'Prioritize investigation. A send or contract needs review, monitoring is incomplete, or delays are persistent or widespread.',
 critical:'Immediate attention. Core background work is unhealthy or unavailable and automated workflows may be affected.',
};
export function reliabilityItemPriority(issue:{kind:string;since:string},now=Date.now()):'minor'|'high'{
 return ['text_receipt','text_review','call_receipt','contract_delivery','contract_preparation','owner_export'].includes(issue.kind)||now-Date.parse(issue.since)>=30*60000?'high':'minor';
}
/** Keep thresholds aligned with icash_reliability_severity, verified together
 * using the same cases. Missing monitoring is never reported as healthy. */
export function reliabilityPriority(report:ReliabilityReport|null,now=Date.now()):ReliabilitySeverity|null{
 if(!report)return 'high';
 const components=[report.components.worker,report.components.maintenance];
 if(components.some(c=>c.status==='degraded'||c.status==='unavailable'))return 'critical';
 if(!report.fresh||!report.snapshot||components.some(c=>c.status!=='ok'))return 'high';
 const {issues,issueCount}=report.snapshot;
 if(issueCount===0)return report.status==='ok'?null:'high';
 if(issueCount>=5||new Set(issues.map(x=>x.accountId)).size>=3||issues.some(x=>reliabilityItemPriority(x,now)==='high'))return 'high';
 return 'minor';
}
