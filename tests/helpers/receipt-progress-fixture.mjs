import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export function receiptProgressSetup(){
 const old=JSON.parse(read('tests/fixtures/stalled-work-production-20261114.json'));
 const sources=JSON.parse(read('tests/fixtures/receipt-progress-source-20261115.json'));
 return read('tests/fixtures/account-work-repair.sql')+'\n'+read('tests/fixtures/stalled-work-boundary.sql')+'\n'+old.observations+';'+
  '\nrevoke all on function public.icash_account_work_observations() from public,anon,authenticated;grant execute on function public.icash_account_work_observations() to service_role;\n'+
  read('config/stalled-work-boundary.sql')+'\n'+read('tests/fixtures/receipt-progress-v2.sql')+'\n'+sources.definitions.map(x=>x.definition+';').join('\n');
}
