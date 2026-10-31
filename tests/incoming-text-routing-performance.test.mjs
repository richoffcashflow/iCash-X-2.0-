import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

// Offline regression: execute the saved production receiver with enough unrelated
// threads to expose a VOLATILE resolver being called once for every table row.
const pg=await PGlite.create();
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const q=(sql,args=[])=>pg.query(sql,args);
const one=async(sql,args=[])=>(await q(sql,args)).rows[0];
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role;
 create table public.icash_operating_budget(id integer primary key);insert into public.icash_operating_budget values(1);
 create table public.icash_text_threads(id uuid primary key default gen_random_uuid(),account_id uuid not null,sender text,recipient text,retired_at timestamptz);
 create table public.icash_text_senders(phone text primary key,enabled boolean);
 create table public.icash_text_suppressions(phone text primary key,reason text);
 create table public.icash_text_events(id text primary key,type text,payload jsonb);
 create table public.icash_text_messages(id uuid primary key default gen_random_uuid(),thread_id uuid,account_id uuid,direction text,body text,attachments jsonb,state text,event_id text unique,provider_id text unique,last_delivery_at timestamptz,updated_at timestamptz default now());
 create sequence public.resolver_calls;
 create function public.icash_sms_resolve_property(p_sender text,p_recipient text,p_body text) returns uuid language plpgsql set search_path='' as $$
 declare chosen uuid;begin
 perform nextval('public.resolver_calls');
 select id into chosen from public.icash_text_threads where sender=p_sender and recipient=p_recipient and retired_at is null;
 return chosen;end $$;
 insert into public.icash_text_threads(account_id,sender,recipient) select gen_random_uuid(),'+12125550100','+1212555'||lpad(n::text,4,'0') from generate_series(1,256) n;`);
 await pg.exec(read('tests/fixtures/incoming-text-routing-baseline.sql'));
 await pg.exec('revoke all on function public.icash_ingest_text_event_before_operational(jsonb,boolean) from public,anon,authenticated;grant execute on function public.icash_ingest_text_event_before_operational(jsonb,boolean) to service_role;');
 const acl=await one("select proacl::text acl,prosecdef from pg_proc where oid='icash_ingest_text_event_before_operational(jsonb,boolean)'::regprocedure");
 const target=await one("select * from icash_text_threads where recipient='+12125550256'");
 const make=(id,overrides={})=>({id,type:'text.incoming.sms',timestamp:1793480000,data:{from:target.recipient,to:target.sender,body:'Tell me more about the offer',message_id:id+'-provider',...overrides}});
 const ingest=(event,optout=false)=>q('select public.icash_ingest_text_event_before_operational($1,$2)',[event,optout]);
 await ingest(make('baseline'));
 const baseline=Number((await one('select last_value from resolver_calls')).last_value);
 assert.equal(baseline,256,'Reproduce the receiver resolving against every unrelated thread');
 await pg.exec(read('config/incoming-text-routing-performance.sql'));
 await pg.exec(read('config/incoming-text-routing-performance.sql'));
 assert.deepEqual(await one("select proacl::text acl,prosecdef from pg_proc where oid='icash_ingest_text_event_before_operational(jsonb,boolean)'::regprocedure"),acl,'No privilege or SECURITY DEFINER changes');
 const before=Number((await one('select last_value from resolver_calls')).last_value);
 const ev=make('fixed');await ingest(ev);
 assert.equal(Number((await one('select last_value from resolver_calls')).last_value)-before,1,'One resolution for an incoming message regardless of thread count');
 assert.deepEqual(await one("select thread_id,account_id,body from icash_text_messages where event_id='fixed'"),{thread_id:target.id,account_id:target.account_id,body:ev.data.body});
 await ingest(ev);
 assert.equal(Number((await one('select last_value from resolver_calls')).last_value)-before,1,'Duplicate event does not rerun routing');
 await ingest({...ev,id:'duplicate-provider'});
 assert.equal((await one("select count(*)::int n from icash_text_messages where provider_id=$1",[ev.data.message_id])).n,1,'Different event IDs cannot duplicate a provider message');
 await ingest(make('unknown',{from:'+12125559999'}));
 assert.deepEqual(await one("select thread_id,account_id,state from icash_text_messages where event_id='unknown'"),{thread_id:null,account_id:null,state:'received'},'Unknown replies stay unassigned');
 await q("insert into icash_text_messages(thread_id,account_id,direction,body,state,provider_id) values($1,$2,'outgoing','Existing message','ready','original-outgoing')",[target.id,target.account_id]);
 await ingest(make('stop',{body:'STOP'}),true);
 assert.equal((await one('select count(*)::int n from icash_text_suppressions where phone=$1',[target.recipient])).n,1);
 assert.equal((await one("select state from icash_text_messages where provider_id='original-outgoing'")).state,'cancelled');
 await ingest({id:'delivery',type:'text.delivery.confirmed',timestamp:1793480001,data:{from:target.sender,to:target.recipient,message_id:'original-outgoing'}});
 await ingest({id:'late-failure',type:'text.delivery.failed',timestamp:1793480002,data:{from:target.sender,to:target.recipient,message_id:'original-outgoing'}});
 assert.equal((await one("select state from icash_text_messages where provider_id='original-outgoing'")).state,'delivered','Late failure cannot overwrite delivery');
 assert((await one("select indexdef from pg_indexes where indexname='icash_text_threads_incoming_pair'")).indexdef.includes('(sender, recipient)'));
 console.log('PASS incoming text receiver: 256 resolver calls reduced to one; exact account routing, unknown replies, event/provider deduplication, STOP, delivery order and privileges preserved. Offline only.');
}finally{await pg.close();}
