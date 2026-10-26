// Actual production selectors and queue logic over synthetic local records only.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('config/seller-opener-preflight.sql');
const baseline=JSON.parse(read('tests/fixtures/seller-opener-preflight-baseline.json'));
const pg=await PGlite.create(),q=(s,a=[])=>pg.query(s,a),one=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,account=uid(1),other=uid(2);
const isolated=async(fn)=>{await pg.exec('begin');try{await fn();}finally{await pg.exec('rollback');}};
try{
 await pg.exec(`
 create role anon;create role authenticated;create role service_role;
 create table icash_operating_budget(id int primary key,enabled boolean);insert into icash_operating_budget values(1,true);
 create table icash_accounts(id uuid primary key,bot_paused boolean default false);
 create table icash_wallets(account_id uuid primary key,balance_cents bigint default 10000,reserved_cents bigint default 0);
 create table icash_customer_identities(account_id uuid primary key,principal text,company_name text);
 create table icash_screening_jobs(id uuid primary key,account_id uuid,state text default 'complete',result jsonb default '{"financialCheck":{"status":"eligible"}}',snapshot jsonb default '{}',completed_at timestamptz default now());
 create table icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid,stage text default 'draft',terms jsonb);
 create table icash_text_threads(id uuid primary key,account_id uuid,deal_id uuid,party text default 'seller',paused boolean default false,ai_mode text default 'auto',seller_intake_id uuid,timezone text default 'America/Chicago',recipient text,review_allowed boolean default true,dispatch_allowed boolean default true,hours_allowed boolean default true);
 create table icash_text_messages(id uuid primary key default gen_random_uuid(),account_id uuid,thread_id uuid,state text,direction text,provider_id text,body text,created_at timestamptz default now());
 create table icash_seller_opener_assignments(thread_id uuid primary key,account_id uuid,variant text,body text,learning_context text,message_id uuid);
 create table icash_seller_intakes(id uuid,phone text,name text);
 create table icash_sms_seller_openings(thread_id uuid primary key,account_id uuid,owner_question_id uuid);
 create table icash_sms_inbound_invitations(message_id uuid,thread_id uuid,expires_at timestamptz);
 create table icash_automation_tickets(id uuid primary key default gen_random_uuid(),account_id uuid,kind text,opener_message_id uuid,created_at timestamptz default now(),token text default gen_random_uuid()::text);
 create table icash_timezone_names(name text);insert into icash_timezone_names values('America/Chicago');
 create table icash_text_suppressions(phone text);create table icash_property_controls(account_id uuid,property_id text,manual boolean);
 create function icash_outreach_sms_current(uuid) returns boolean language sql stable as $$select exists(select 1 from public.icash_customer_identities where account_id=$1 and nullif(trim(principal),'') is not null)$$;
 create function icash_sms_thread_review_current(uuid,uuid,boolean) returns boolean language sql stable as $$select coalesce((select review_allowed from public.icash_text_threads where id=$2 and account_id=$1),false)$$;
 create function icash_sms_thread_dispatch_until(uuid,uuid) returns timestamptz language sql stable as $$select case when dispatch_allowed then now()+interval '1 hour' else now()-interval '1 hour' end from public.icash_text_threads where id=$2 and account_id=$1$$;
 create function icash_sms_outreach_window_current(uuid,uuid) returns boolean language sql stable as $$select hours_allowed from public.icash_text_threads where id=$2 and account_id=$1$$;
 create function icash_conversation_street(text) returns text language sql immutable as $$select trim($1)$$;
 create function icash_seller_contact_evidence(uuid,uuid,uuid,text) returns jsonb language sql stable as $$select null::jsonb$$;
 create function icash_seller_recipient_opener(uuid,uuid,text,text,text) returns text language sql stable as $$select null::text$$;
 create function icash_next_before_seller_openers() returns jsonb language sql as $$select null::jsonb$$;
 create function icash_assign_seller_opener(uuid,uuid) returns jsonb language plpgsql as $$begin
 insert into public.icash_seller_opener_assignments(thread_id,account_id,variant,body,learning_context) values($2,$1,'fixture','Is this {owner} of {address}?','interest-v2');
 return jsonb_build_object('context','interest-v2','body','Is this {owner} of {address}?');end$$;
 create function icash_queue_text(uuid,uuid,uuid,text,uuid[]) returns uuid language plpgsql as $$declare message uuid;begin
 insert into public.icash_text_messages(account_id,thread_id,state,direction,body) values($1,$2,'ready','outgoing',$4) returning id into message;
 update public.icash_seller_opener_assignments set message_id=message where thread_id=$2 and account_id=$1;return message;end$$;
 `);
 for(const a of [account,other]){await q('insert into icash_accounts(id) values($1)',[a]);await q('insert into icash_wallets(account_id) values($1)',[a]);await q("insert into icash_customer_identities values($1,'Fixture investor',null)",[a]);}
 for(const definition of Object.values(baseline))await pg.exec(definition);
 await pg.exec('revoke all on function icash_queue_seller_opener(uuid,uuid),icash_next_before_unstarted_sms_recovery(),icash_next_before_sms_inbound_campaign() from public,anon,authenticated;grant execute on function icash_queue_seller_opener(uuid,uuid),icash_next_before_unstarted_sms_recovery(),icash_next_before_sms_inbound_campaign() to service_role');
 const add=async(n,address='123 Main St',a=account)=>{const id=uid(n);await q("insert into icash_screening_jobs(id,account_id,snapshot) values($1,$2,jsonb_build_object('propertyId',($1::uuid)::text))",[id,a]);await q("insert into icash_deal_files(id,account_id,screening_id,terms) values($1,$2,$1,jsonb_build_object('address',$3::text))",[id,a,address]);await q('insert into icash_text_threads(id,account_id,deal_id,recipient) values($1,$2,$1,$3)',[id,a,'+1214555'+String(n).padStart(4,'0')]);return id;};
 const selected=async(fn)=>{const ticket=await one(`select ${fn}()`);return ticket?.token?one('select m.thread_id from icash_automation_tickets t join icash_text_messages m on m.id=t.opener_message_id where t.token=$1',[ticket.token]):null;};
 await isolated(async()=>{await add(100,'123 O\'Brien St');await add(200);assert.equal(await selected('icash_next_before_unstarted_sms_recovery'),null,'reproduces a malformed first candidate starving a valid later text');assert.equal(await one('select count(*) from icash_text_messages'),0);});
 const originalQueue=await one("select pg_get_functiondef('icash_queue_seller_opener(uuid,uuid)'::regprocedure)");
 await pg.exec(sql);
 await pg.exec(read('config/seller-opener-scan-fence.sql'));
 assert.equal(await one("select pg_get_functiondef('icash_queue_seller_opener(uuid,uuid)'::regprocedure)"),originalQueue,'final queue admission is unchanged');
 const actualPreview=await one("select prosrc from pg_proc where proname='icash_seller_opener_candidate_body'");
 const prefix=originalQueue.split('AS $function$\n')[1].split(' choice:=public.icash_assign_seller_opener')[0].replace(/ ?perform 1 from public\.icash_operating_budget where id=1 for update;\n/g,'').replace(' for update;',';');
 assert.equal(actualPreview.trim(),(prefix+' return message_body;\nend ').trim(),'preflight exactly mirrors all existing pre-assignment checks without locks or writes');
 for(const fn of ['icash_next_before_unstarted_sms_recovery','icash_next_before_sms_inbound_campaign'])await isolated(async()=>{
  for(let n=100;n<140;n++)await add(n,"123 O'Brien St");
  const good=await add(200,'789 Oak Rd',other);
  assert.equal(await selected(fn),good,'all invalid rows are excluded before LIMIT, across accounts');
  assert.equal(await one('select count(*) from icash_text_messages'),1);assert.equal(await one('select count(*) from icash_seller_opener_assignments'),1,'invalid candidates create no assignments');
 });
 for(const problem of ['blank','long','characters','review','assignment','identity','pause','hours','expired','suppressed','manual','practice','stale'])await isolated(async()=>{
  const bad=await add(100),good=await add(200,'789 Oak Rd',other);
  const changes={blank:"update icash_deal_files set terms='{}' where id=$1",long:"update icash_deal_files set terms=jsonb_build_object('address',repeat('A',170)) where id=$1",characters:"update icash_deal_files set terms=jsonb_build_object('address','Unit #7') where id=$1",review:'update icash_text_threads set review_allowed=false where id=$1',assignment:"insert into icash_seller_opener_assignments(thread_id,account_id) select id,account_id from icash_text_threads where id=$1",identity:"update icash_customer_identities set principal='' where account_id=(select account_id from icash_text_threads where id=$1)",pause:'update icash_text_threads set paused=true where id=$1',hours:'update icash_text_threads set hours_allowed=false where id=$1',expired:'update icash_text_threads set dispatch_allowed=false where id=$1',suppressed:'insert into icash_text_suppressions select recipient from icash_text_threads where id=$1',manual:'insert into icash_property_controls select account_id,id::text,true from icash_text_threads where id=$1',practice:"update icash_deal_files set terms=terms||'{\"practice\":true}' where id=$1",stale:"update icash_screening_jobs set completed_at=now()-interval '25 hours' where id=$1"};
  await q(changes[problem],[bad]);assert.equal(await selected('icash_next_before_unstarted_sms_recovery'),good,problem+' must not block the next account');
 });
 await isolated(async()=>{
  const invitation=await add(100);const message=uid(900);
  await q("insert into icash_text_messages(id,account_id,thread_id,state,direction,body) values($1,$2,$3,'ready','outgoing','Existing reviewed invitation')",[message,account,invitation]);
  await q("insert into icash_sms_inbound_invitations values($1,$2,now()+interval '1 hour')",[message,invitation]);
  assert.equal(await one('select icash_seller_opener_candidate_body($1,$2)',[account,invitation]),null);
  assert.equal(await selected('icash_next_before_unstarted_sms_recovery'),invitation,'existing one-use invitations retain their separate path');
  assert.equal(await one('select count(*) from icash_text_messages'),1);
 });
 await isolated(async()=>{
  const unknown=await add(100),good=await add(200,'789 Oak Rd',other);
  await q("insert into icash_text_messages(account_id,thread_id,state,direction) values($1,$2,'needs_review','outgoing')",[account,unknown]);
  assert.equal(await selected('icash_next_before_unstarted_sms_recovery'),good);
  assert.equal(await one("select state from icash_text_messages where thread_id=$1",[unknown]),'needs_review','uncertain sends are never replayed');
 });
 await isolated(async()=>{await add(100);await pg.exec('update icash_operating_budget set enabled=false');assert.equal(await selected('icash_next_before_unstarted_sms_recovery'),null);});
 for(const fn of ['icash_next_before_unstarted_sms_recovery','icash_next_before_sms_inbound_campaign'])await isolated(async()=>{
  for(let n=100;n<150;n++)await add(n);
  await pg.exec(`create table fixture_preflight_calls(thread_id uuid);
   alter function icash_seller_opener_candidate_body(uuid,uuid) rename to fixture_original_preflight;
   create function icash_seller_opener_candidate_body(a uuid,t uuid) returns text language plpgsql as $$begin
    insert into public.fixture_preflight_calls values(t);return public.fixture_original_preflight(a,t);end$$;`);
  assert.equal(await selected(fn),uid(100));
  assert.equal(await one('select count(*) from fixture_preflight_calls'),1,'full source/contact proof runs only until a qualifying ordered row is found');
 });
 assert.equal(Number(await one('select sum(balance_cents) from icash_wallets')),20000);
 for(const role of ['anon','authenticated'])assert.equal(await one("select has_function_privilege($1,'icash_seller_opener_candidate_body(uuid,uuid)','execute')",[role]),false);
 const filename=readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(n=>n.endsWith('_seller_opener_preflight.sql'));assert(filename);assert.equal(sql,read('supabase/migrations/'+filename));
 const scanFilename=readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(n=>n.endsWith('_seller_opener_scan_fence.sql'));assert.equal(read('config/seller-opener-scan-fence.sql'),read('supabase/migrations/'+scanFilename));
 console.log('Seller opener preflight: malformed/held first records cannot starve later accounts; original queue, invitations, recipient checks, Pause, unknown sends, wallet and private access preserved. Local fixtures only.');
}finally{await pg.close();}
