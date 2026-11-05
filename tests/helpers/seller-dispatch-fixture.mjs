import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {currentAdmissionSql} from './seller-opener-bounded-admission.mjs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const captured=JSON.parse(read('tests/fixtures/outreach-scheduler-20261105.json'));
export function sellerDispatchFixture({actual=false,bounded=true}={}){
 const foundation=actual?currentAdmissionSql(true):read('tests/fixtures/seller-opener-bounded-scan.sql')+`
 create schema icash_work_private;
 revoke all on schema icash_work_private from public,anon,authenticated;
 grant usage on schema icash_work_private to service_role;
 create table icash_work_private.seller_opener_scan(id integer primary key,last_thread_id uuid,updated_at timestamptz default now());
 alter table icash_work_private.seller_opener_scan enable row level security;
 revoke all on icash_work_private.seller_opener_scan from public,anon,authenticated,service_role;
 grant select on icash_work_private.seller_opener_scan to service_role;
 grant update(last_thread_id,updated_at) on icash_work_private.seller_opener_scan to service_role;
 insert into icash_work_private.seller_opener_scan(id) values(1);
 create function icash_outreach_sms_current(uuid) returns boolean language sql stable as $$select true$$;
 create table icash_sms_inbound_invitations(id uuid);
 `;
 return foundation+`
 alter table icash_sms_inbound_invitations add thread_id uuid,add message_id uuid,add expires_at timestamptz;
 `+captured.filter(x=>['icash_issue_ready_seller_text()','icash_next_before_unstarted_sms_recovery()','icash_next_before_sms_inbound_campaign()'].includes(x.signature)).map(x=>x.definition+';').join('\n')+`
 grant usage on schema public to service_role;
 grant select,insert,update,delete on all tables in schema public to service_role;
 revoke all on all functions in schema public from public,anon,authenticated;
 grant execute on all functions in schema public to service_role;
 `+(bounded?read('config/seller-dispatch-bounded-scan.sql'):'');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify({original:sellerDispatchFixture({bounded:false}),bounded:sellerDispatchFixture(),actual:sellerDispatchFixture({actual:true}),actualOriginal:sellerDispatchFixture({actual:true,bounded:false})}));
