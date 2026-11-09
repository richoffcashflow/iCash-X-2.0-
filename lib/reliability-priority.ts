import type {ReliabilityReport} from './reliability.ts';
export const reliabilitySeverities=['minor','high','critical'] as const;
export type ReliabilitySeverity=typeof reliabilitySeverities[number];
export const reliabilitySeverityLabels={minor:'Minor',high:'High',critical:'Critical'};
export const reliabilitySeverityGuidance={
 minor:'An isolated workflow is delayed. Core background checks are healthy; recovery can continue.',
 high:'Prioritize investigation. A send or contract needs review, monitoring is incomplete, or delays are persistent or widespread.',
 critical:'Immediate attention. Background services are unhealthy or multiple funded accounts are blocked or failing to complete work.',
};
export function reliabilityImpact(report:ReliabilityReport|null):string{
 if(!report?.fresh||!report.snapshot)return 'Current workflow health is unverified. Refresh monitoring before judging recovery.';
 const affected=[report.components.worker.status!=='ok'?'background scheduling':null,report.components.maintenance.status!=='ok'?'maintenance':null].filter(Boolean);
 if(affected.length)return `Service problem: ${affected.join(' and ')}. Healthy work lanes can continue, but affected work may be delayed.`;
 if(report.status==='ok'&&report.snapshot.issueCount===0&&(report.snapshot.accountProgress?.affectedAccounts??0)===0)return 'Background checks are responding; no active workflow alerts were found in this check.';
 return 'Background checks are responding. The alerts below identify individual workflows and accounts that still need recovery.';
}
export const reliabilityRecoveryGuidance='Failed scheduler checks retry automatically with backoff. Independent eligible work can continue. Earlier calls, texts and charges keep their original receipts and holds until their outcome is verified.';
export function reliabilityItemPriority(issue:{kind:string;since:string},now=Date.now()):'minor'|'high'{
 return ['text_receipt','text_review','call_receipt','contract_delivery','contract_preparation','owner_export'].includes(issue.kind)||now-Date.parse(issue.since)>=30*60000?'high':'minor';
}
/** Keep thresholds aligned with icash_reliability_severity, verified together
 * using the same cases. Missing monitoring is never reported as healthy. */
export function reliabilityPriority(report:ReliabilityReport|null,now=Date.now()):ReliabilitySeverity|null{
 if(!report)return 'high';
 if((report.snapshot?.accountProgress?.affectedAccounts??0)>=3)return 'critical';
 const components=[report.components.worker,report.components.maintenance];
 if(components.some(c=>c.status==='degraded'||c.status==='unavailable'))return 'critical';
 if(!report.fresh||!report.snapshot||components.some(c=>c.status!=='ok'))return 'high';
 const {issues,issueCount}=report.snapshot;
 if(issueCount===0)return report.status==='ok'?null:'high';
 if(issueCount>=5||new Set(issues.map(x=>x.accountId)).size>=3||issues.some(x=>reliabilityItemPriority(x,now)==='high'))return 'high';
 return 'minor';
}
