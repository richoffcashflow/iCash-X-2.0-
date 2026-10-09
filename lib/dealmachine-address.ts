export const sellerAddressFormatVersion = 'us-structured-2026-10-09.1';

export type DealMachineAddress = {full_address: string} | {
  street: string; unit?: string; city: string; state: string; zip?: string;
};
const states = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY AS GU MP PR VI'.split(' '));
const unitPattern = /^(?:apt\.?|apartment|unit|suite|ste\.?|#)\s*[\p{L}\p{N}-]+$/iu;

/** Keep the submitted address as evidence; format only the provider request.
 * Never guess a missing city, ZIP, street number or unit.
 */
export function dealMachineAddress(value: string): DealMachineAddress {
  const address = value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/, (?:USA|US|U\.S\.A\.?|U\.S\.?|United States(?: of America)?)$/i, '');
  if (!address || address.length > 300 || /[\u0000-\u001f<>]/u.test(address)) throw Error('INVALID_PROPERTY_ADDRESS');
  const fallback = {full_address: address};
  const parts = address.split(', ');
  if (parts.length !== 3 && parts.length !== 4) return fallback;
  const region = /^([A-Z]{2})(?: (\d{5})(?:-\d{4})?)?$/i.exec(parts.at(-1)!);
  const city = parts.at(-2)!;
  if (!region || !states.has(region[1].toUpperCase()) || !/^[\p{L}][\p{L}\p{M} .'-]*$/u.test(city)) return fallback;
  let street = parts[0], unit = parts.length === 4 ? parts[1] : undefined;
  if (unit && !unitPattern.test(unit)) return fallback;
  if (!/^\d[^,]*\s\S/u.test(street)) return fallback;
  const inlineUnit = /^(.*?)\s+((?:apt\.?|apartment|unit|suite|ste\.?|#)\s*[\p{L}\p{N}-]+)$/iu.exec(street);
  if (inlineUnit) {
    if (unit) return fallback;
    street = inlineUnit[1]; unit = inlineUnit[2];
  }
  // Google address selection can abbreviate Loop as Lp. Keep the submitted
  // address intact, but send the spelled-out suffix to the property matcher.
  // Only a terminal suffix after a street name is eligible; never alter units,
  // street names such as "Lp Ranch", or ambiguous free-form address strings.
  street = street.replace(/^(\d\S*\s+.+)\s+lp\.?$/i, '$1 Loop');
  return {street, ...(unit ? {unit} : {}), city, state: region[1].toUpperCase(), ...(region[2] ? {zip: region[2]} : {})};
}

/** Small private receipt; no owner/contact data or unbounded provider payloads. */
export function sellerAddressReceipt(input: DealMachineAddress, raw: unknown) {
  const payload = raw as {data?: {matched?: unknown; match_failure?: {code?: unknown; reason?: unknown}; match_warning?: {code?: unknown}}[]};
  const row = Array.isArray(payload?.data) && payload.data.length === 1 ? payload.data[0] : null;
  const clean = (value: unknown, limit: number) => typeof value === 'string' ? value.replace(/[\u0000-\u001f<>]/gu, ' ').slice(0, limit) : null;
  return {
    version: sellerAddressFormatVersion, input, matched: typeof row?.matched === 'boolean' ? row.matched : null,
    failureCode: clean(row?.match_failure?.code, 80), failureReason: clean(row?.match_failure?.reason, 300),
    warningCode: clean(row?.match_warning?.code, 80),
  };
}
