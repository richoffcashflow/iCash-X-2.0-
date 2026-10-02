/** Render an installation template from explicit private deployment input.
 * This module never reads environment variables, writes files, or executes SQL.
 * Existing installations must not be migrated again. */
export function renderOwnerInboundSchema(template, reviewedAccountSid) {
  if (typeof reviewedAccountSid !== 'string' || !/^AC[0-9a-fA-F]{32}$/.test(reviewedAccountSid)) {
    throw Error('OWNER_INBOUND_SCHEMA_ACCOUNT_REQUIRED');
  }
  const marker = '{{OWNER_INBOUND_TWILIO_ACCOUNT_SID}}';
  if (typeof template !== 'string' || template.split(marker).length !== 2) {
    throw Error('OWNER_INBOUND_SCHEMA_TEMPLATE_INVALID');
  }
  const rendered = template.replace(marker, "'" + reviewedAccountSid + "'");
  if (rendered.includes('{{') || rendered.includes('}}')) throw Error('OWNER_INBOUND_SCHEMA_TEMPLATE_INVALID');
  return rendered;
}
