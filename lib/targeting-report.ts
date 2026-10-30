import {z} from 'zod';
import {targetingDefinitionSchema} from './dealmachine-targeting.ts';
const count=z.number().int().nonnegative(),rate=z.number().nonnegative().nullable();
export const targetingReportSchema=z.object({
 version:z.literal('seller-targeting-v1'),checkedAt:z.string(),cohortsTruncated:z.boolean(),dedupPending:count,dedupReadyAccounts:count,configuredAccounts:count,
 settings:z.object({enabled:z.boolean(),mobile_verified:z.boolean()}),capabilities:z.unknown(),
 experiments:z.array(z.object({id:z.uuid(),enabled:z.boolean(),definition:targetingDefinitionSchema})),
 cohorts:z.array(z.object({accountId:z.uuid(),zip:z.string().regex(/^\d{5}$/),strategy:z.string(),properties:count,attempted:count,pendingAttempts:count,
  validContactProperties:count,qualifiedConversations:count,offers:count,signedContracts:count,matureContractSamples:count,
  researchCostMicros:count,providerCostMicros:count,costCents:count,costsComplete:z.boolean(),
  qualifiedPerProviderDollar:rate,qualifiedPerCustomerDollar:rate,contractsPerProviderDollar:rate,contractsPerCustomerDollar:rate,
  evidenceStatus:z.enum(['costs_incomplete','collecting','review_required']),winnerDeclared:z.literal(false),
 })),
});
export type TargetingReport=z.infer<typeof targetingReportSchema>;
