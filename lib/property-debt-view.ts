type RecordValue=Record<string,unknown>;
const record=(value:unknown):RecordValue=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as RecordValue:{};
const cents=(value:unknown,signed=false):number|null=>typeof value==='number'&&Number.isSafeInteger(value)&&(signed||value>=0)?value:null;
const positive=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0;

/** Saved research only: unknown debt is not zero, and a false lien flag is not clear title. */
export function propertyDebtView(result:unknown){
 const property=record(record(result).property),screen=record(property.financialScreening);
 const mortgageCents=cents(screen.estimatedLoanBalanceCents);
 const equityCents=cents(Object.hasOwn(screen,'equityCents')?screen.equityCents:property.estimatedEquityCents,true);
 const liensReported=screen.activeLien===true||screen.hoaLien===true||positive(screen.activeLiens)||positive(screen.openLiens)||positive(screen.lienAmountCents);
 const taxesReported=screen.taxDelinquent===true;
 const date=typeof property.fetchedAt==='string'?Date.parse(property.fetchedAt):NaN;
 return {mortgageCents,equityCents,liensReported,taxesReported,
  lienStatus:liensReported?'Reported':screen.status==='title_review_needed'&&!taxesReported?'Needs confirmation':'Not confirmed',
  conflicting:screen.status==='conflicting_data',
  payoffMayExceedOffer:screen.status==='payoff_may_exceed_budget',
  fetchedAt:Number.isFinite(date)?new Date(date).toISOString():null,
 };
}
