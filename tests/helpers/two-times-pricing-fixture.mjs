import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export function pricingBlock(name){
 const sql=read('config/two-times-usage-pricing.sql'),tag='$usage_'+name+'$';
 const start=sql.indexOf('do '+tag),end=sql.indexOf('end '+tag+';',start);
 assert(start>=0&&end>start,name);return sql.slice(start,end+('end '+tag+';').length);
}
export function pricingBaseline(name){
 const sql=read('tests/fixtures/two-times-pricing-baseline.sql');
 const start=sql.indexOf('CREATE OR REPLACE FUNCTION '+(name==='automatic_components'?'icash_recorded_reception_private.':'public.')+name+'(');
 assert(start>=0,name);const end=sql.indexOf('$function$;',sql.indexOf('AS $function$',start));
 return sql.slice(start,end+'$function$;'.length);
}
