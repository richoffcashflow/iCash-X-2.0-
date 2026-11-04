import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {setupSql as literalSetup,migration as literalMigration,queueSql,seedSql,expected as original} from './seller-opener-literal-address-fixture.mjs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export const setupSql=literalSetup+literalMigration+`
alter table public.icash_text_messages add customer_author_id uuid;
alter table public.icash_seller_opener_assignments add created_at timestamptz default now(),
 add constraint icash_seller_opener_assignments_learning_context_check
 check(learning_context in ('opener-v1','interest-v2','identity-v3'));
alter table public.icash_automation_tickets add state text default 'issued',
 add expires_at timestamptz default now()+interval '5 minutes',add completed_at timestamptz,add outcome text;
alter table public.icash_sms_inbound_invitations add message_id uuid,add thread_id uuid;
create table public.icash_text_ai_jobs(id uuid,outgoing_id uuid);
create table public.icash_live_conversations(operation_key text);
update public.icash_seller_opener_variants set body='Hi, contacting you for {principal} about a cash offer. Do you own {address}? Reply STOP to opt out.' where key='identity-v3';
`;
export const migration=read('config/seller-opener-footer-free-copy.sql');
export const expected=original.replace(' Reply STOP to opt out.','');
export {seedSql,queueSql,original};
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify({setupSql,migration,seedSql,queueSql,expected,original}));
