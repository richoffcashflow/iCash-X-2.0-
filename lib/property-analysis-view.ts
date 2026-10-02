type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const money = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const text = (value: unknown, max = 200): string | null => typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null;
const timestamp = (value: unknown): string | null => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

/** Presentation of saved screening evidence only. Never calculates or authorizes an offer. */
export function propertyAnalysisView(result: unknown) {
 const saved = record(result), property = record(saved.property), arv = record(property.arvEstimate), repairs = record(property.repairs), range = record(repairs.rangeCents);
 const baselineCents = money(repairs.baselineCents), low = money(range.low), high = money(range.high);
 const suppliedRange = repairs.rangeCents != null || repairs.rangeStatus === 'available' || repairs.rangeStatus === 'invalid';
 const validRange = repairs.rangeStatus !== 'invalid' && low !== null && high !== null && low <= high && (baselineCents === null || low <= baselineCents && baselineCents <= high);
 const rangeCents = validRange ? {low, high} : null;
 const repairStatus = suppliedRange && !validRange ? 'invalid' as const : rangeCents ? 'range' as const : baselineCents !== null ? 'baseline' as const : 'missing' as const;
 // Both fields are already normalized cents from the provider's estimated_value.
 // An explicitly missing ARV estimate must not be replaced by a stale fallback.
 const arvCents = Object.hasOwn(arv, 'cents') ? money(arv.cents) : money(property.estimatedMarketValueCents);
 const source = property.source === 'dealmachine' ? 'DealMachine' : text(property.source) ?? 'Saved property research';
 return {
  cashOfferCeilingCents: money(saved.preliminarySellerCeilingCents),
  arvCents,
  repairs: {baselineCents, rangeCents, status: repairStatus, condition: text(repairs.condition, 100), source: repairs.provider === 'dealmachine' ? 'DealMachine' : source},
  source,
  fetchedAt: timestamp(property.fetchedAt),
  // The saved screening result has no verified comparable-sales schema or
  // provider provenance. Do not reinterpret estimates, listings or loose arrays
  // as recorded sales, and do not initiate a paid lookup from presentation code.
  comparableSalesStatus: 'not_recorded' as const,
 };
}

export function analysisMoney(cents: number | null): string {
 return cents === null ? 'Not available' : new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD', minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2}).format(cents / 100);
}
