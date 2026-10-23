// Local synthetic PostgreSQL only. No customer records or provider calls.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=new PGlite(),q=(s,a=[])=>pg.query(s,a),val=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const sql=read('config/nationwide-parallel-dispatch.sql');
const migration=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(n=>n.endsWith('_nationwide_parallel_dispatch.sql'));
assert.equal(migration.length,1);assert.equal(read('supabase/migrations/'+migration[0]),sql);
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role;
 create table icash_inventory_geography_sources(state_code text primary key,next_page int not null default 1,next_scan_at timestamptz not null default now(),claim_token uuid,claim_until timestamptz,checked_at timestamptz,last_error text);
 create function icash_research_state_allowed(text) returns boolean language sql immutable as $$select $1<>all(string_to_array('CT IL IA MN NE OK OR PA SC UT VA WI',' '))$$;
 create table icash_discovery_configs(account_id uuid primary key,auto_enabled boolean default true,data_rights_until timestamptz default now()+interval '1 year',inventory_refreshed_at timestamptz);
 create table icash_bot_setups(account_id uuid primary key,profile jsonb);
 create table icash_property_zip_geographies(zip text primary key,state_code text,property_count bigint,checked_at timestamptz default now(),expires_at timestamptz default now()+interval '30 days');
 create table icash_inventory_markets(account_id uuid,zip text,priority int,eligible_until timestamptz,next_scan_at timestamptz default now(),primary key(account_id,zip));
 insert into icash_inventory_geography_sources(state_code,next_page,claim_token,claim_until,checked_at) values('TX',7,'${id(99)}',now()+interval '2 minutes',now());`);
 // The exact issuer patch is exercised on its real dependencies by the account
 // fairness suite. Here the rest of this migration executes without substitution.
 await pg.exec(sql.replace(/do \$patch\$[\s\S]*?end \$patch\$;/,''));
 assert.equal(Number(await val('select count(*) from icash_inventory_geography_sources')),39);
 assert.equal(await val("select next_page from icash_inventory_geography_sources where state_code='TX'"),7);
 assert.equal(await val("select claim_token::text from icash_inventory_geography_sources where state_code='TX'"),id(99),'existing lease is preserved');
 assert.equal(Number(await val("select count(*) from icash_inventory_geography_sources where state_code in ('CA','FL','NY','WA','DC')")),5);
 const claims=[];for(let i=0;i<4;i++)claims.push(await val('select icash_claim_inventory_geographies()'));
 assert.equal(new Set(claims.map(c=>c.state)).size,4);assert(claims.every(c=>c.state!=='TX'&&c.page===1));
 await pg.exec("update icash_inventory_geography_sources set next_scan_at=now()+interval '1 hour';insert into icash_inventory_geography_sources(state_code) values('CT');");
 assert.equal(await val('select icash_claim_inventory_geographies()'),null,'excluded state and failed-page backoff cannot be bypassed');
 for(let n=1;n<=4;n++)await q('insert into icash_discovery_configs(account_id) values($1)',[id(n)]);
 await q('insert into icash_bot_setups values($1,$2)',[id(2),{marketMode:'city',market:'90001'}]);
 await q('update icash_discovery_configs set auto_enabled=false where account_id=$1',[id(3)]);
 await q("update icash_discovery_configs set data_rights_until=now()-interval '1 day' where account_id=$1",[id(4)]);
 await pg.exec("insert into icash_property_zip_geographies(zip,state_code,property_count) select (90000+n)::text,case when n%2=0 then 'CA' else 'FL' end,2000 from generate_series(1,450) n;");
 await pg.exec("insert into icash_property_zip_geographies(zip,state_code,property_count,expires_at) values('99991','CT',2000,now()+interval '1 day'),('99992','CA',0,now()+interval '1 day'),('99993','CA',2000,now()-interval '1 day');");
 const expand=account=>val('select icash_expand_inventory_markets($1)',[account]);
 assert.equal(await expand(id(1)),200);assert.equal(await expand(id(1)),0,'refresh pacing holds');
 await q("update icash_inventory_markets set next_scan_at=now()+interval '6 hours' where account_id=$1",[id(1)]);
 for(const expected of [200,50,0]){
  await q('update icash_discovery_configs set inventory_refreshed_at=null where account_id=$1',[id(1)]);
  assert.equal(await expand(id(1)),expected,'later passes advance beyond the first 200 ZIPs');
 }
 assert.equal(Number(await val('select count(*) from icash_inventory_markets where account_id=$1',[id(1)])),450);
 assert.equal(Number(await val('select count(*) from icash_inventory_markets where account_id=$1 and next_scan_at>now()',[id(1)])),200,'cooldowns are not reset by expansion');
 for(const n of [2,3,4])assert.equal(await expand(id(n)),0,'saved scope, automatic disable and expired rights remain final');
 assert.equal(Number(await val("select count(*) from icash_inventory_markets where zip in ('99991','99992','99993')")),0);
 for(const role of ['anon','authenticated'])for(const fn of ['icash_claim_inventory_geographies()','icash_expand_inventory_markets(uuid)'])assert.equal(await val('select has_function_privilege($1,$2,\'execute\')',[role,fn]),false);
 console.log('Nationwide inventory: 39 eligible jurisdictions, preserved leases, distinct claims, state/backoff guards, 450 ZIP expansion and saved scope passed.');
}finally{await pg.close();}
