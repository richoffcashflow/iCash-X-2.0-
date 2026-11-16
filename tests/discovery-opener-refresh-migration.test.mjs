import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createDiscoveryOpenerRefreshFixture} from './helpers/discovery-opener-refresh-fixture.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const names=['discovery-opener-refresh','discovery-opener-refresh-apply'];
const assembled='-- Source-bound inactive discovery opener renewal.\n-- The migration runner owns the transaction and schema-history receipt.\n'+names.map(n=>'-- Source: config/'+n+'.sql\n'+read('config/'+n+'.sql').split('\n').filter(line=>line!=='begin;'&&line!=='commit;').join('\n').trimEnd()+'\n').join('\n');
const migration=read('supabase/migrations/20261116183352_discovery_opener_refresh.sql');
assert.equal(migration,assembled,'migration mirrors both reviewed components exactly');
assert(!/^begin;|^commit;/m.test(migration),'runner owns the atomic schema/history transaction');
assert.match(migration,/enabled boolean not null default false/);
assert.match(migration,/check\(not enabled or coalesce\(release_sha/,'missing release evidence fails closed');
assert.match(migration,/unique\(renewal_id,kind\)/,'each paid stage is one-use');
assert.match(migration,/message_id uuid not null unique/,'no second generation silently retries this draft');
const apply=read('config/discovery-opener-refresh-apply.sql');
for(const row of JSON.parse(read('tests/fixtures/discovery-opener-refresh-live-predecessors.json')))assert(apply.includes(row.hash),'source pin retained: '+row.name);
assert(!/processDiscoveryOpenerRefresh/.test(read('app/api/internal/seller/route.ts')),'no implicit scheduler activation');
const f=await createDiscoveryOpenerRefreshFixture(createRequire(import.meta.url).resolve('@electric-sql/pglite'),{skipRenewal:true});
try{
 const predecessor=JSON.parse(read('tests/fixtures/discovery-opener-refresh-live-predecessors.json')).find(x=>x.name==='icash_lock_operational_dnc(uuid,uuid)').definition;
 await f.pg.exec('create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key);');
 const absent=async()=>assert.equal((await f.one("select to_regnamespace('icash_discovery_refresh_private') missing")).missing,null);
 // A changed predecessor must reject after the first component without leaving
 // any partial schema behind. The runner, not the migration, owns rollback.
 await f.pg.exec("create or replace function public.icash_lock_operational_dnc(p_account uuid,p_contact uuid) returns boolean language plpgsql security definer set search_path='' as $$begin return false;end$$;");
 await f.pg.exec('begin;');
 await assert.rejects(f.pg.exec(migration),/predecessor changed/);
 await f.pg.exec('rollback;');await absent();
 await f.pg.exec(predecessor);
 await f.pg.exec('begin;');await f.pg.exec(migration);
 await f.q("insert into supabase_migrations.schema_migrations values('20261116183352')");
 await assert.rejects(f.q('select 1/0'),/division by zero/);
 await f.pg.exec('rollback;');await absent();
 assert.equal((await f.one('select count(*)::int n from supabase_migrations.schema_migrations')).n,0,'schema and ledger roll back together');
 await f.pg.exec('begin;');await f.pg.exec(migration);
 await f.q("insert into supabase_migrations.schema_migrations values('20261116183352')");await f.pg.exec('commit;');
 assert.equal((await f.one('select enabled from icash_discovery_refresh_private.policy')).enabled,false);
 assert.equal((await f.one('select count(*)::int n from icash_discovery_refresh_private.requests')).n,0);
 assert.equal((await f.one('select count(*)::int n from supabase_migrations.schema_migrations')).n,1);
 console.log('PASS exact inactive migration, full source-pin and schema/ledger rollback, one-use guards and no scheduler hook.');
}finally{await f.pg.close();}
