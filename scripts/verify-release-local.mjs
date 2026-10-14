// Every application build verifies critical behavior without contacting providers.
// Provider configuration/readback is a separate, explicit release operation.
import {spawnSync} from 'node:child_process';
const suites = [
 'dashboard-password', 'dashboard-boundaries',
 'workspace-simplification', 'workspace-stage-summary', 'buyer-network-workspace', 'fulfillment-guidance', 'workspace-next-actions', 'deal-tools-disclosure',
 'property-analysis-summary', 'property-debt-summary',
 'seller-submission-status',
 'seller-agreement-identity', 'seller-agreement-evidence', 'live-agreement-history', 'live-agreement-route',
 'seller-agreement-delivery-status', 'seller-agreement-delivery-preflight',
 'contract-delivery-readiness-database',
 'seller-scenario-fine-tuning', 'buyer-intent-context',
 'agreement-delivery-recovery', 'seller-queue-handoff',
 'closing-payout-readiness-database', 'title-request-snapshot-database', 'title-service',
 'paid-provider-tests-disabled', 'buyer-package-photos', 'buyer-package-email',
 'deal-documents', 'signing-service-validation', 'assignment-contract-policy',
 'buyer-scenarios', 'buyer-privacy-release-source', 'worker-recovery',
 'cost-efficiency', 'property-photo-route', 'property-photo', 'persistent-property-photo',
 'reliability-database', 'text-receipt-recovery', 'worker-heartbeat', 'reliability-monitor', 'service-health',
 'text-sender-routing', 'sms-channel-admission', 'contract-text', 'contract-text-resend',
 'owner-overview-route', 'owner-overview-ui', 'workspace-request-recovery', 'durable-work-billing-stop',
];
for (const suite of suites) {
 const result=spawnSync(process.execPath,['--experimental-strip-types',`tests/${suite}.test.mjs`],{stdio:'inherit',timeout:60000});
 if(result.error||result.status!==0)process.exit(result.status||1);
}
