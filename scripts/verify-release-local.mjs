// Every application build verifies critical behavior without contacting providers.
// Provider configuration/readback is a separate, explicit release operation.
import {spawnSync} from 'node:child_process';
const suites = [
 'cancellation-notifications', 'agreement-cancellation', 'live-dispatch',
 'workspace-acknowledgment', 'work-account-membership', 'account-activity-route', 'manual-funding-route', 'early-access-funding', 'course-preview-contracts', 'course-preview-access',
 'consented-browser-calling-database', 'contact-rpc-readback', 'manual-call-options', 'browser-phone-route', 'browser-phone-service', 'browser-call-session', 'authority-review-status', 'sms-review-status-route',
 'dashboard-password', 'dashboard-boundaries', 'webinar-offer-save', 'webinar-flow-ui',
 'webinar-entry-route', 'webinar-intelligence-route', 'webinar-vip', 'webinar-growth', 'webinar-recovery', 'webinar-return-database',
 'webinar-purchase-flow', 'webinar-exit-reminder', 'webinar-chat-no-assistant', 'webinar-followup-routes', 'webinar-replay-spots',
 'workspace-simplification', 'workspace-stage-summary', 'buyer-network-workspace', 'fulfillment-guidance', 'workspace-next-actions', 'deal-tools-disclosure',
 'property-analysis-summary', 'property-debt-summary',
 'seller-submission-status',
 'optin-call-now-route', 'optin-call-now-database',
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
 'owner-overview-route', 'owner-overview-ui', 'admin-experience-route', 'admin-experience-ui',
 'workspace-panel-content', 'production-release-gate', 'production-health',
 'workspace-experience', 'workspace-experience-database', 'reliability-alerts',
 'workspace-request-recovery', 'durable-work-billing-stop',
 'usage-loop-policy', 'usage-loop-route', 'usage-loop-context-database',
 'usage-loop-tracking', 'usage-loop-tracking-routes', 'workspace-conversion-ui',
 'credit-refill-context', 'credit-refill-recommendation',
];
for (const suite of suites) {
 const result=spawnSync(process.execPath,['--experimental-strip-types',`tests/${suite}.test.mjs`],{stdio:'inherit',timeout:60000});
 if(result.error||result.status!==0)process.exit(result.status||1);
}
