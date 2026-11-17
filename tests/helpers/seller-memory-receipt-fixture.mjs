import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
export const migration=readFileSync(new URL('../../config/seller-memory-receipt-time.sql',import.meta.url),'utf8');
export const oldHash='f1316a0d62155d6f61426b7419e52cf2';
export async function setup(pg){
await pg.exec(`do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;end $$;
create schema icash_seller_agreement_private;create schema icash_recorded_reception_private;
create table icash_accounts(id uuid primary key);
create table icash_screening_jobs(id uuid primary key);
create table icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid,stage text,terms jsonb);
create table icash_contact_permissions(account_id uuid,screening_id uuid,phone text,party text);
create table icash_text_threads(id uuid primary key,account_id uuid,deal_id uuid,recipient text,party text,retired_at timestamptz);
create table icash_text_messages(id uuid primary key default gen_random_uuid(),account_id uuid,thread_id uuid,direction text,state text,body text,provider_id text,event_id text,created_at timestamptz,last_delivery_at timestamptz);
create table icash_text_events(id text primary key,type text,payload jsonb);
create function icash_sms_reply_time(p uuid) returns numeric language sql stable as $$select coalesce(case when jsonb_typeof(e.payload->'timestamp')='number' then (e.payload->>'timestamp')::numeric end,extract(epoch from m.created_at)) from public.icash_text_messages m left join public.icash_text_events e on e.id=m.event_id where m.id=p$$;
create table icash_live_conversations(id uuid primary key,account_id uuid,screening_id uuid,contact_key text,party text,state text,operation_key text,completed_at timestamptz,result jsonb,conversation_id text);
create table icash_call_recordings(account_id uuid,operation_key text,provider_started_at timestamptz);
create table icash_seller_agreement_private.call_history(session_id uuid,account_id uuid,screening_id uuid,contact_key text,completed_at timestamptz,transcript jsonb,conversation_id text);
create table icash_recorded_reception_private.sessions(id uuid,account_id uuid,provider_started_at timestamptz,conversation_id text,from_phone text,call_ended_at timestamptz);`);
await pg.exec(readFileSync(new URL('../../config/seller-shared-memory.sql',import.meta.url),'utf8'));
await pg.exec(readFileSync(new URL('../../config/seller-memory-screening-index.sql',import.meta.url),'utf8'));
}
export function api(pg){
 const query=(sql,args=[])=>pg.query(sql,args);
 const rpc=async(name,args)=>(await query(`select public.${name}(${Object.keys(args).map((_,i)=>'$'+(i+1)).join(',')}) value`,Object.values(args))).rows[0].value;
 const db=(path,_method,args)=>rpc(path.slice(4),args);
 const hash=async()=>(await query("select md5(pg_get_functiondef('public.icash_seller_memory_context(uuid,uuid,text)'::regprocedure)) hash")).rows[0].hash;
 return {query,rpc,db,hash};
}
export async function fixture(pg){
 const {query,rpc,db}=api(pg),account=randomUUID(),screen=randomUUID(),deal=randomUUID(),thread=randomUUID(),phone='+12125550123';
 const binding={accountId:account,screeningId:screen,dealId:deal,phone};
 await query('insert into icash_accounts values($1)',[account]);await query('insert into icash_screening_jobs values($1)',[screen]);
 await query("insert into icash_deal_files values($1,$2,$3,'draft','{}')",[deal,account,screen]);
 await query("insert into icash_text_threads values($1,$2,$3,$4,'seller',null)",[thread,account,deal,phone]);
 await query('update icash_seller_memory_private.settings set enabled=true');
 const at=n=>new Date(Date.UTC(2020,0,1)+n*1000).toISOString();
 async function turn(direction,body,created,{state=direction==='outgoing'?'delivered':'received',delivery=direction==='outgoing'?created+.1:null,eventTime=direction==='incoming'?created:null,eventType='text.incoming.sms',eventId=direction==='incoming'?randomUUID():null,provider='fixture',which=thread,eventExists=true}={}){
  const id=randomUUID();if(eventId&&eventExists)await query('insert into icash_text_events values($1,$2,$3) on conflict(id) do update set type=excluded.type,payload=excluded.payload',[eventId,eventType,eventTime===null?{}:{timestamp:typeof eventTime==='number'?1577836800+eventTime:eventTime}]);
  await query('insert into icash_text_messages values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,account,which,direction,state,body,provider,eventId,at(created),delivery===null?null:at(delivery)]);
  return {id,eventId};
 }
 const context=()=>rpc('icash_seller_memory_context',{p_account:account,p_screening:screen,p_phone:phone});
 return {query,rpc,db,binding,account,screen,deal,thread,phone,at,turn,context};
}
