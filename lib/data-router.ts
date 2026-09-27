/** Route a lookup by verified capability, rights, quality, and effective cost. */
export type DataTask = "property" | "contact" | "comps" | "parcel";
export type ProviderQuote = {
  name: string;
  tasks: DataTask[];
  available: boolean;
  licensedForUse: boolean;
  supportsMarket: boolean;
  unitCostCents: number;
  observedUsefulResultRate: number; // measured on comparable requests, not vendor claim
  freshnessPassRate: number;
};
export function chooseDataProvider(task: DataTask, quotes: ProviderQuote[]): ProviderQuote | null {
  const eligible = quotes.filter(q => q.available && q.licensedForUse && q.supportsMarket && q.tasks.includes(task) && Number.isSafeInteger(q.unitCostCents) && q.unitCostCents >= 0 && q.observedUsefulResultRate > 0 && q.observedUsefulResultRate <= 1 && q.freshnessPassRate >= .7 && q.freshnessPassRate <= 1);
  eligible.sort((a,b) => a.unitCostCents / (a.observedUsefulResultRate * a.freshnessPassRate) - b.unitCostCents / (b.observedUsefulResultRate * b.freshnessPassRate) || a.name.localeCompare(b.name));
  return eligible[0] ?? null;
}
