import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const installed=[['20261103162508', 'recorded-reception-identity-backoff'], ['20261103162517', 'seller-opener-bounded-scan'], ['20261103181852', 'seller-opener-literal-ampersand'], ['20261103181900', 'text-receipt-queue-fairness'], ['20261103181911', 'owner-retry-fair-priority'], ['20261103182413', 'owner-preflight-list-indexing'], ['20261103182541', 'owner-preflight-quota-recovery'], ['20261103183354', 'research-quota-monitoring'], ['20261103183400', 'identity-bound-opportunity-buffer']];
for(const [version,name] of installed){
 const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
 assert.equal(read('config/'+name+'.sql'),read('supabase/migrations/'+version+'_'+name.replaceAll('-','_')+'.sql'));
}
console.log('PASS all nine installed recovery migrations preserve the reviewed configurations.');
