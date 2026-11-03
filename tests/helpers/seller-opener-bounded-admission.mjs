import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export const captured=JSON.parse(read('tests/fixtures/seller-opener-bounded-current-admission.json'));
export const selector=JSON.parse(read('tests/fixtures/text-message-thread-scheduler-before.json')).definition;
export function currentAdmissionSql(bounded=true){
 const triggers=JSON.parse(read('tests/fixtures/text-delivery-recovery-triggers.json')).filter(t=>['icash_sms_message_route','icash_observe_seller_opener'].includes(t.proname));
 if(triggers.length!==2)throw Error('Expected the two original routing/opener triggers');
 return read('tests/fixtures/seller-opener-bounded-scan.sql')+selector+';\n'+
  read('tests/helpers/seller-opener-bounded-admission.sql')+captured.functions.map(f=>f.definition+';').join('\n')+
  triggers.map(t=>t.definition+';').join('\n')+
  '\ncreate trigger icash_sms_price_snapshot before insert on public.icash_text_messages for each row execute function public.icash_snapshot_sms_price();\n'+
  'grant usage on schema public to service_role;grant select,insert,update,delete on all tables in schema public to service_role;'+
  'revoke all on all functions in schema public from public,anon,authenticated;grant execute on all functions in schema public to service_role;\n'+
  (bounded?read('config/seller-opener-bounded-scan.sql'):'');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify({original:currentAdmissionSql(false),bounded:currentAdmissionSql(true)}));
