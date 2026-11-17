import {readFileSync} from 'node:fs';
export const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
export const migration=read('config/seller-opener-property-lookup.sql');
export const migrationPath='supabase/migrations/20261117184814_seller_opener_property_lookup.sql';
export const signature='public.icash_next_before_sms_inbound_campaign()';
export const beforeHash='e6f81c009c46713083f8dc882e6b7d1f',afterHash='3b84ca1902ff715d3882b8dd6ebba935';
export const beforePredicate="and not exists(select 1 from public.icash_property_controls pc where pc.account_id=a.id and pc.property_id=s.snapshot->>'propertyId' and pc.manual)";
export const afterPredicate=beforePredicate.slice(0,-1)+' offset 0)';
export const value=async(db,sql,args=[])=>Object.values((await db.query(sql,args)).rows[0]??{})[0];
export const definition=db=>value(db,'select pg_get_functiondef($1::regprocedure)',[signature]);
export const id=n=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const account=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const execute=(db,sql)=>db.exec?db.exec(sql):db.query(sql);
export async function install(db){
 await execute(db,read('tests/fixtures/seller-opener-bounded-scan.sql'));
 await execute(db,JSON.parse(read('tests/fixtures/text-message-thread-scheduler-before.json')).definition);
 await execute(db,'revoke all on all functions in schema public from public,anon,authenticated;grant execute on all functions in schema public to service_role;');
 await execute(db,read('config/seller-opener-bounded-scan.sql'));
}
export function candidateQuery(source){
 const part=source.split(' for candidate in\n')[1]?.split('\n loop\n')[0];
 if(!part)throw Error('Captured candidate boundary missing');
 return part.replaceAll('cursor_id','$1::uuid');
}
export const metadata=db=>value(db,"select jsonb_build_object('owner',proowner,'definer',prosecdef,'volatile',provolatile,'parallel',proparallel,'strict',proisstrict,'leakproof',proleakproof,'config',proconfig,'acl',proacl) from pg_proc where oid=$1::regprocedure",[signature]);
export const state=db=>value(db,"select jsonb_build_object('wallets',(select jsonb_agg(to_jsonb(w) order by account_id) from public.icash_wallets w),'controls',(select jsonb_agg(to_jsonb(c) order by account_id,property_id) from public.icash_property_controls c),'cursor',(select to_jsonb(c) from icash_work_private.seller_opener_scan c where id=1),'messages',(select jsonb_agg(to_jsonb(m) order by id) from public.icash_text_messages m),'tickets',(select jsonb_agg(to_jsonb(t) order by id) from public.icash_automation_tickets t))");
export const planNodes=plan=>[plan,...(plan.Plans??[]).flatMap(planNodes)];
