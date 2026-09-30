/** UI parsing only. The authenticated API and database enforce every permission. */
export function confirmQualificationNavigation(dirty: boolean, confirm: (message: string) => boolean) {
  return !dirty || confirm('You have unsaved buyer review details. Discard them and leave this view?');
}

export function qualificationMoney(value: string) {
  const text = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw Error('Enter a dollar amount, including 0 when intended.');
  const [whole, fraction = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > 100000000000) throw Error('Check the dollar amount.');
  return cents;
}

export function qualificationDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) throw Error('Choose a complete local date and time.');
  const parts = match.slice(1).map(x => Number(x ?? 0));
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getFullYear() !== parts[0] || date.getMonth() + 1 !== parts[1] || date.getDate() !== parts[2] || date.getHours() !== parts[3] || date.getMinutes() !== parts[4] || date.getSeconds() !== parts[5]) throw Error('Choose a valid local date and time.');
  return date.toISOString();
}

export function qualificationPayload(form: FormData, dealId: string) {
  const text = (key: string) => String(form.get(key) ?? '').trim();
  const propertyTypes = form.getAll('propertyTypes').map(String);
  if (!propertyTypes.length || propertyTypes.some(x => x !== 'house' && x !== 'land')) throw Error('Choose at least one property type.');
  return {
    buyerId: text('buyerId'), dealId,
    markets: text('markets').split(/\r?\n/).map(x => x.trim()).filter(Boolean),
    propertyTypes,
    maxPriceCents: qualificationMoney(text('maxPrice')),
    maxRepairCents: qualificationMoney(text('maxRepairs')),
    criteriaObservedAt: qualificationDate(text('observedAt')),
    expiresAt: qualificationDate(text('expiresAt')),
    sourceName: text('sourceName'), sourceReference: text('sourceReference'), buyerStatement: text('buyerStatement'),
  };
}

export function qualificationDecision(form: FormData, requestId: string) {
  const text = (key: string) => String(form.get(key) ?? '').trim();
  const decision = text('decision');
  if (!['approved', 'needs_information', 'declined', 'revoked'].includes(decision)) throw Error('Choose a review decision.');
  const base = {requestId, decision, note: text('note')};
  if (decision !== 'approved') return base;
  if (['criteriaConfirmed', 'fundsVerified', 'signatoryVerified'].some(key => form.get(key) !== 'on')) throw Error('Complete each actual evidence review before approving.');
  return {...base, verification: {
    criteriaConfirmed: true, fundsVerified: true, signatoryVerified: true,
    reviewReference: text('reviewReference'), validUntil: qualificationDate(text('validUntil')),
    fundsReference: text('fundsReference'), fundsObservedAt: qualificationDate(text('fundsObservedAt')),
    fundsAmountCents: qualificationMoney(text('fundsAmount')), currency: 'USD',
    signatoryName: text('signatoryName'), authorityReference: text('authorityReference'),
    authorityObservedAt: qualificationDate(text('authorityObservedAt')),
  }};
}
