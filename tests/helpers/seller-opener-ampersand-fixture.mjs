import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {currentAdmissionSql} from './seller-opener-bounded-admission.mjs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export const recipient=JSON.parse(read('tests/fixtures/seller-recipient-opener-current.json'));
export const migration=read('config/seller-opener-literal-ampersand.sql');
// Exact current opener/text queues, recipient helper and routing/price/observer
// triggers. Source review/cadence are explicit offline fixture boundaries.
export const setupSql=currentAdmissionSql(true)+`
create table public.icash_seller_matches(lead_id uuid,account_id uuid,screening_id uuid);
create table public.icash_seller_recipient_ordinals(lead_id uuid,account_id uuid,recipient_ordinal integer);
${recipient.definition};
grant select on public.icash_seller_matches,public.icash_seller_recipient_ordinals to service_role;
revoke all on function public.icash_seller_recipient_opener(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.icash_seller_recipient_opener(uuid,uuid,text,text,text) to service_role;
`;
export const seedSql="select fixture_seed_admission(1,1);update icash_customer_identities set company_name='A & B Homes';";
export const queueSql='select public.icash_queue_seller_opener(account_id,id) from public.icash_text_threads';
export const expected='Hi, contacting you for A & B Homes about a cash offer. Do you own 123 Main St? Reply STOP to opt out.';
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify({setupSql,migration,seedSql,queueSql,expected}));
