import {readFileSync, readdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {setupSql, migration as learning, seedSql, queueSql} from './seller-sms-learning-v5-fixture.mjs';

const migrations = new URL('../../supabase/migrations/', import.meta.url);
const names = readdirSync(migrations).filter(name => name.endsWith('_sender_delay_opener_recovery.sql'));
if (names.length !== 1) throw Error('Expected one sender delay recovery migration');
export const migration = readFileSync(new URL(names[0], migrations), 'utf8');
export const setup = setupSql + learning + seedSql + queueSql + `;
 create schema icash_text_receipt_private;
 grant usage on schema icash_text_receipt_private to service_role;
 alter table icash_text_events add type text;
 alter table icash_operation_spend add dispatched_at timestamptz;
 update icash_text_messages set state='accepted',provider_id='text_fixture_delay';
 update icash_seller_opener_assignments set created_at=now()-interval '15 minutes';
 insert into icash_operation_spend select 'text:'||id,account_id,'settled',now()-interval '12 minutes' from icash_text_messages;
`;
export const delay = `insert into icash_text_events(id,type,payload)
 values('evt_delay','numbers.delayed',jsonb_build_object('id','evt_delay','type','numbers.delayed',
 'timestamp',extract(epoch from now()),'data',jsonb_build_object('original_number','+17205550100',
 'affected_id','text_fixture_delay','reason','number_temporary_unavailable')));`;
export const age = `update icash_text_events set payload=jsonb_set(payload,'{timestamp}',to_jsonb(extract(epoch from now()-interval '6 minutes'))) where id='evt_delay';`;
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
 console.log(JSON.stringify({setup,migration,delay,age}));
