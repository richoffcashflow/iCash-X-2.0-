// Disposable localhost PostgreSQL only; uses the production index statements and
// guarded function patch supplied by the shared fixture. Never installs remotely.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,lstat,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,isAbsolute} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
// Compare the exact SQL tokens in ledger order. Only comments, inter-token
// whitespace and statement terminators are ignored; strings/dollar bodies stay exact.
function sqlTokens(sql){
 const tokens=[];let i=0;
 while(i<sql.length){
  if(/\s/.test(sql[i])||sql[i]===';'){i++;continue;}
  if(sql.startsWith('--',i)){const end=sql.indexOf('\n',i);i=end<0?sql.length:end+1;continue;}
  if(sql.startsWith('/*',i)){const end=sql.indexOf('*/',i+2);assert(end>=0);i=end+2;continue;}
  const dollar=sql.slice(i).match(/^\$[A-Za-z_0-9]*\$/)?.[0];
  if(dollar){const end=sql.indexOf(dollar,i+dollar.length);assert(end>=0);tokens.push(sql.slice(i,end+dollar.length));i=end+dollar.length;continue;}
  if(sql[i]==="'"||sql[i]==='"'){const start=i,quote=sql[i++];let closed=false;while(i<sql.length){if(sql[i++]===quote){if(sql[i]===quote){i++;continue;}closed=true;break;}}assert(closed);tokens.push(sql.slice(start,i));continue;}
  const word=sql.slice(i).match(/^[A-Za-z_0-9]+/)?.[0];
  if(word){tokens.push(word);i+=word.length;}else tokens.push(sql[i++]);
 }return tokens;
}
import {Client,connection} from './preparation-native-db.mjs';
export async function verifyPreparationInstallation(f,{indexStatements,patchSql,migrations}){
 const {q,one,pg}=f;
 const names=['icash_dnc_clear_phone_expiry','icash_dnc_clear_national_screening_expiry'];
 assert.equal(indexStatements.length,2);
 for(let i=0;i<2;i++){
  assert(new RegExp('create\\s+index\\s+concurrently\\s+(?:public\\.)?'+names[i]+'\\b','i').test(indexStatements[i]));
  assert(!/if\s+not\s+exists/i.test(indexStatements[i]),'Never silently accept an existing index');
  assert(!/\bbegin\s*;/i.test(indexStatements[i]),'Concurrent builds must be standalone');
 }
 assert(!/^\s*create\s+(?:unique\s+)?index/im.test(patchSql),'Function migration must not create indexes');
 const builder=new Client({...connection,application_name:'preparation-index-builder'});
 const oldWriter=new Client({...connection,application_name:'preparation-old-writer'});
 const freshWriter=new Client({...connection,application_name:'preparation-new-writer'});
 let pending;
 const snapshot=async()=>({
  definition:(await one("select pg_get_functiondef('icash_prepare_operational_contacts_before_dm_observations(uuid)'::regprocedure) value")).value,
  receipts:(await q('select to_jsonb(r) value from icash_dnc_verification_receipts r order by id')).rows,
  budget:(await q('select to_jsonb(b) value from icash_operating_budget b order by id')).rows,
  wallets:(await q('select to_jsonb(w) value from icash_wallets w order by account_id')).rows
 });
 const before=await snapshot();
 const preserved=async()=>assert.deepEqual(await snapshot(),before,'Failed/staged installation preserves original function, receipts, budget and wallets');
 const refuse=async label=>{
  let error;
  try{await pg.exec(patchSql);}catch(e){error=e;}finally{await q('rollback');}
  assert(error,label+' must reject the guarded function migration');
  // Guard failures are deliberate SQL exceptions, not permissions/syntax errors.
  assert.equal(error.code,'P0001',label+': '+error.message);
  assert.match(error.message,/Preparation receipt binding indexes are absent, invalid, or changed/,label);
  await preserved();
 };
 const ready=async name=>(await one('select indisvalid,indisready from pg_index where indexrelid=$1::regclass',[name]));
 try{
  await Promise.all([builder.connect(),oldWriter.connect(),freshWriter.connect()]);
  for(const client of [builder,oldWriter,freshWriter])await client.query("set statement_timeout='15s';set lock_timeout='12s'");
  const builderPid=(await builder.query('select pg_backend_pid() pid')).rows[0].pid;
  const oldPid=(await oldWriter.query('select pg_backend_pid() pid')).rows[0].pid;
  const waitForOldWriter=async()=>{
   const deadline=Date.now()+5000;
   while(Date.now()<deadline){
    const row=await one(`select a.wait_event_type,$2::int=any(pg_blocking_pids(a.pid)) blocked,
     exists(select 1 from pg_stat_progress_create_index p where p.pid=a.pid and p.relid='icash_dnc_verification_receipts'::regclass and p.phase='waiting for writers before build') phase
     from pg_stat_activity a where a.pid=$1`,[builderPid,oldPid]);
    if(row.wait_event_type==='Lock'&&row.blocked&&row.phase)return;
    await new Promise(resolve=>setTimeout(resolve,10));
   }
   assert.fail('Concurrent index must demonstrably wait on the old receipt writer before build');
  };
  const beginOldWriter=async()=>{
   await oldWriter.query('begin');
   const result=await oldWriter.query('update icash_dnc_verification_receipts set revoked_at=revoked_at where id=(select id from icash_dnc_verification_receipts order by id limit 1) returning id');
   assert.equal(result.rowCount,1);
  };
  const startBuild=()=>{pending=builder.query(indexStatements[0]);pending.catch(()=>{});};
  await refuse('Missing indexes');
  // Both names exist, but a valid same-name index with the wrong key must fail.
  await builder.query(`create index ${names[0]} on public.icash_dnc_verification_receipts(id)`);
  await builder.query(indexStatements[1]);
  await refuse('Wrong definition with both indexes present');
  await assert.rejects(builder.query(indexStatements[0]),error=>error.code==='42P07');
  await builder.query(`drop index concurrently public.${names[0]}`);

  await beginOldWriter();startBuild();await waitForOldWriter();
  assert.equal((await one('select pg_cancel_backend($1) canceled',[builderPid])).canceled,true);
  await assert.rejects(pending,error=>error.code==='57014');pending=null;
  assert.equal((await ready(names[0])).indisvalid,false,'Canceled concurrent build leaves an invalid index');
  await refuse('Invalid index with exact definition');
  await assert.rejects(builder.query(indexStatements[0]),error=>error.code==='42P07','Retry cannot silently accept the invalid index');
  await oldWriter.query('rollback');
  await builder.query(`drop index concurrently public.${names[0]}`);
  await builder.query(`drop index concurrently public.${names[1]}`);
  await preserved();

  // Genuine fresh receipt insertion succeeds while CREATE INDEX CONCURRENTLY
  // is waiting on an earlier writer. Roll it back to preserve fixture evidence.
  await beginOldWriter();startBuild();await waitForOldWriter();
  await freshWriter.query('begin');
  const inserted=await freshWriter.query(`insert into icash_dnc_verification_receipts
   select cloned.* from (select * from icash_dnc_verification_receipts order by id limit 1) r
   cross join lateral jsonb_populate_record(null::icash_dnc_verification_receipts,
    to_jsonb(r)||jsonb_build_object('id',gen_random_uuid(),'provider_reference','LOCAL concurrent installation receipt')) cloned returning id`);
  assert.equal(inserted.rowCount,1,'Another receipt writer can insert during the waiting build');
  await freshWriter.query('rollback');
  await waitForOldWriter(); // proves the writer finished before releasing builder
  await oldWriter.query('rollback');await pending;pending=null;
  assert.deepEqual(await ready(names[0]),{indisvalid:true,indisready:true});
  await builder.query(indexStatements[1]);
  assert.deepEqual(await ready(names[1]),{indisvalid:true,indisready:true});
  await preserved();
  // Even a successful guarded patch is transactional: deliberately rolling its
  // transaction back leaves the predecessor intact and permits the real retry.
  assert(!/^\s*(?:begin|commit)\s*;/im.test(patchSql),'CLI owns the function-and-ledger transaction');
  await pg.exec('begin;\n'+patchSql+'\nrollback;');
  await preserved();
  // Exercise the actual pinned CLI runner on the reviewed three-stage chain
  // and one synthetic later migration. This is NOT a full historical replay or
  // evidence that --include-all is safe against the repository/production history.
  const cli=process.env.PREPARATION_SUPABASE_CLI;
  assert(cli&&isAbsolute(cli),'Explicit absolute pinned Supabase CLI path required');
  assert.equal(migrations.length,3);
  assert.deepEqual(migrations.map(m=>m.sql),[...indexStatements,patchSql]);
  const directory=await mkdtemp(join(tmpdir(),'preparation-cli-'));
  const runs=[];
  try{
   const home=join(directory,'home');await mkdir(home);
   const environment={PATH:process.env.PATH,HOME:home,TMPDIR:directory,CI:'1',NO_COLOR:'1',DO_NOT_TRACK:'1',SUPABASE_TELEMETRY_DISABLED:'1'};
   const run=async args=>{
    try{const result=await execute(cli,args,{cwd:directory,env:environment,timeout:120000,maxBuffer:10*1024*1024});runs.push({args,stdout:result.stdout,stderr:result.stderr});return result.stdout;}
    catch(error){runs.push({args,stdout:error.stdout,stderr:error.stderr,error:error.message});throw error;}
   };
   assert.match(await run(['--version']),/\b3\.0\.0\b/,'Test runner version must be pinned');
   await run(['init','--yes','--workdir='+directory]);
   const migrationDirectory=join(directory,'supabase','migrations');await mkdir(migrationDirectory,{recursive:true});
   for(const migration of migrations){assert(/^\d{14}_[a-z_]+\.sql$/.test(migration.name));await writeFile(join(migrationDirectory,migration.name),migration.sql);}
   for(const name of names)await builder.query('drop index concurrently public.'+name);
   await preserved();
   const url='postgresql://postgres:isolated-preparation-only@127.0.0.1:55444/icash_preparation_test?sslmode=disable&application_name=preparation-cli-migration&options='+encodeURIComponent('-c lock_timeout=5s -c statement_timeout=60s');
   // The query command uses one prepared statement. Check startup settings here;
   // the event trigger below proves the migration runner retains them after RESET ALL.
   const timeoutProof="select current_setting('lock_timeout') as lock_timeout,current_setting('statement_timeout') as statement_timeout,current_setting('application_name') as application_name,extract(epoch from current_setting('lock_timeout')::interval)::int as lock_seconds,extract(epoch from current_setting('statement_timeout')::interval)::int as statement_seconds,case when current_setting('lock_timeout')::interval=interval '5 seconds' and current_setting('statement_timeout')::interval=interval '60 seconds' and current_setting('application_name')='preparation-cli-migration' then 'bounded-fixture-startup-ok' else 'fixture-startup-timeouts-not-honored' end as verified";
   const startup=await run(['db','query',timeoutProof,'--remote='+url,'--yes','--workdir='+directory]);
   assert(startup.includes('bounded-fixture-startup-ok'),'CLI startup settings were not honored: '+startup);
   // Disposable event trigger verifies the actual CREATE INDEX sessions, not
   // merely a separate connection using the same URL. Observe every CREATE INDEX
   // during this isolated CLI run, since the CLI may change application_name.
   // Exact index identities and timeout durations are still required below.
   // No migration bytes change.
   await q(`create table public.fixture_preparation_cli_timeouts(identity text,application text,lock_timeout text,statement_timeout text,lock_seconds integer,statement_seconds integer);
    create function public.fixture_preparation_cli_timeouts() returns event_trigger language plpgsql as $fixture$
    declare command record;
    begin
     if tg_tag='CREATE INDEX' then
      if current_setting('lock_timeout')::interval<>interval '5 seconds' or current_setting('statement_timeout')::interval<>interval '60 seconds' then
       raise exception 'Actual CLI index timeout mismatch: lock=% (% seconds), statement=% (% seconds), application=%',
        current_setting('lock_timeout'),extract(epoch from current_setting('lock_timeout')::interval),current_setting('statement_timeout'),extract(epoch from current_setting('statement_timeout')::interval),current_setting('application_name');
      end if;
      for command in select * from pg_event_trigger_ddl_commands() loop
       insert into public.fixture_preparation_cli_timeouts values(command.object_identity,current_setting('application_name'),current_setting('lock_timeout'),current_setting('statement_timeout'),extract(epoch from current_setting('lock_timeout')::interval)::int,extract(epoch from current_setting('statement_timeout')::interval)::int);
      end loop;
     end if;
    end $fixture$;
    create event trigger fixture_preparation_cli_timeouts on ddl_command_end when tag in ('CREATE INDEX') execute function public.fixture_preparation_cli_timeouts()`);
   const args=['migration','up','--remote='+url,'--yes','--workdir='+directory];
   // A rejected third ledger insert must roll back the function patch too.
   // This tests the CLI's real transaction boundary, rather than inferring it
   // from a successful apply or trusting a no-op second run.
   assert.equal((await one("select to_regclass('supabase_migrations.schema_migrations') relation")).relation,null);
   const functionVersion=migrations[2].name.slice(0,14);assert(/^\d{14}$/.test(functionVersion));
   await q(`create schema if not exists supabase_migrations;
    create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);
    create function public.fixture_preparation_reject_ledger() returns trigger language plpgsql as $fixture$
    begin
     if new.version='${functionVersion}' then raise exception 'Fixture forced function ledger failure';end if;
     return new;
    end $fixture$;
    create trigger fixture_preparation_reject_ledger before insert on supabase_migrations.schema_migrations for each row execute function public.fixture_preparation_reject_ledger()`);
   const ledger=async()=>(await q('select version,name,statements from supabase_migrations.schema_migrations order by version')).rows;
   await assert.rejects(run(args),error=>(String(error.stdout??'')+String(error.stderr??'')).includes('Fixture forced function ledger failure'),'Injected ledger rejection must fail the actual CLI apply');
   assert.deepEqual((await ledger()).map(row=>row.version),migrations.slice(0,2).map(m=>m.name.slice(0,14)),'Only independent index stages persist after rejected function ledger insert');
   await preserved();
   await q('drop trigger fixture_preparation_reject_ledger on supabase_migrations.schema_migrations;drop function public.fixture_preparation_reject_ledger()');
   await run(args);
   const firstLedger=await ledger();
   const timeoutRows=(await q('select * from public.fixture_preparation_cli_timeouts order by identity')).rows;
   assert.deepEqual(timeoutRows.map(({identity,lock_seconds,statement_seconds})=>({identity,lock_seconds,statement_seconds})),names.map(name=>({identity:'public.'+name,lock_seconds:5,statement_seconds:60})).sort((a,b)=>a.identity.localeCompare(b.identity)),'Both actual CLI concurrent builds honor configured timeouts: '+JSON.stringify(timeoutRows));
   assert.equal(firstLedger.length,3,'Only the three staged migration versions are recorded');
   for(let i=0;i<3;i++){
    const match=migrations[i].name.match(/^(\d{14})_(.+)\.sql$/);
    assert.equal(firstLedger[i].version,match[1]);assert.equal(firstLedger[i].name,match[2]);
    assert(Array.isArray(firstLedger[i].statements));
    assert.deepEqual(firstLedger[i].statements.flatMap(sqlTokens),sqlTokens(migrations[i].sql),'Recorded statements match exact reviewed SQL tokens');
   }
   const oldQuery=patchSql.match(/old_query text:=\$old\$([\s\S]*?)\$old\$/)[1];
   const newQuery=patchSql.match(/new_query text:=\$new\$([\s\S]*?)\$new\$/)[1];
   const installed=await snapshot();assert.equal(installed.definition,before.definition.replace(oldQuery,newQuery));
   assert.deepEqual({...installed,definition:before.definition},before,'CLI install preserves all fixture evidence and funds');
   for(const name of names)assert.deepEqual(await ready(name),{indisvalid:true,indisready:true});
   await run(args);
   assert.deepEqual(await ledger(),firstLedger,'Second CLI run does not replay or change ledger entries');
   assert.deepEqual((await q('select * from public.fixture_preparation_cli_timeouts order by identity')).rows,timeoutRows,'Second CLI run does not build indexes again');
   assert.deepEqual(await snapshot(),installed,'Second CLI run leaves installed function and evidence unchanged');
   // Simulate the real older-pending shape without importing unrelated history:
   // apply one later, fixture-only migration through this same CLI, retain its
   // matching local file, then reset ONLY our three synthetic installation rows.
   const laterName='20261103235959_fixture_later_recorded.sql';
   const laterVersion=laterName.slice(0,14);
   assert(migrations.every(m=>m.name.slice(0,14)<laterVersion));
   const laterSql="create table public.fixture_preparation_later_evidence(id integer primary key,value text not null);\ninsert into public.fixture_preparation_later_evidence values(1,'later migration evidence must survive');\n";
   await writeFile(join(migrationDirectory,laterName),laterSql);
   await run(args);
   const laterRow=(await ledger()).find(row=>row.version===laterVersion);
   assert(laterRow);assert.deepEqual(laterRow.statements.flatMap(sqlTokens),sqlTokens(laterSql));
   const laterEvidence=async()=>(await q('select to_jsonb(e) value from public.fixture_preparation_later_evidence e order by id')).rows;
   const laterBefore=await laterEvidence();assert.equal(laterBefore.length,1);
   const preserveLater=async()=>{
    assert.deepEqual((await ledger()).find(row=>row.version===laterVersion),laterRow,'Later migration ledger remains byte-for-byte unchanged');
    assert.deepEqual(await laterEvidence(),laterBefore,'Later migration evidence remains unchanged');
   };
   await pg.exec(before.definition);
   for(const name of names)await builder.query('drop index concurrently public.'+name);
   const removed=await q('delete from supabase_migrations.schema_migrations where version in ($1,$2,$3)',migrations.map(m=>m.name.slice(0,14)));
   assert.equal(removed.rowCount,3,'Reset only the three fixture preparation versions');
   await q('delete from public.fixture_preparation_cli_timeouts');
   await preserved();await preserveLater();
   // Build an immutable release-only artifact from the exact installed ledger,
   // then byte-verify its materialization in a separate initialized CLI workdir.
   // Keeping CLI config outside the artifact preserves the builder's closed tree.
   const {planPreparationReleaseManifest,buildPreparationReleaseManifest,validatePreparationReleaseManifest}=await import('../../scripts/build-preparation-release-manifest.mjs');
   const capturedLedger=await ledger();assert.deepEqual(capturedLedger,[laterRow]);
   const pinnedMigrations=migrations.map(m=>{const match=m.name.match(/^(\d{14})_(.+)\.sql$/);return {version:match[1],name:match[2],bytes:Buffer.from(m.sql)};});
   const artifactDirectory=join(directory,'release-artifact');
   const release=await buildPreparationReleaseManifest({ledgerRows:capturedLedger,migrations:pinnedMigrations,outputDirectory:artifactDirectory});
   assert.deepEqual(release.pendingVersions,migrations.map(m=>m.name.slice(0,14)),'Release prototype permits exactly the three reviewed pending versions');
   const releasePlan=planPreparationReleaseManifest({ledgerRows:capturedLedger,migrations:pinnedMigrations});
   const releaseCliDirectory=join(directory,'release-cli');await mkdir(releaseCliDirectory);
   await run(['init','--yes','--workdir='+releaseCliDirectory]);
   const releaseCliMigrations=join(releaseCliDirectory,'supabase','migrations');await mkdir(releaseCliMigrations,{recursive:true});
   const mappedFiles=[...releasePlan.files].filter(([path])=>path.startsWith('migrations/'));
   for(const [path,bytes] of mappedFiles)await writeFile(join(releaseCliMigrations,path.slice(11)),bytes,{flag:'wx',mode:0o600});
   const pendingChecks=[];
   const validateRelease=async expectedPending=>{
    await validatePreparationReleaseManifest({directory:artifactDirectory,ledgerRows:capturedLedger,migrations:pinnedMigrations,expectedLedgerSha256:release.ledgerSha256});
    for(const ancestor of [directory,releaseCliDirectory,join(releaseCliDirectory,'supabase'),releaseCliMigrations]){
     const stat=await lstat(ancestor);assert(stat.isDirectory()&&!stat.isSymbolicLink(),'CLI directory ancestor must be a real directory');
     assert.equal(await realpath(ancestor),ancestor,'CLI directory aliases are refused');
    }
    const entries=await readdir(releaseCliMigrations);assert.deepEqual(entries.sort(),mappedFiles.map(([path])=>path.slice(11)).sort());
    for(const [path,bytes] of mappedFiles){const file=join(releaseCliMigrations,path.slice(11)),stat=await lstat(file);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1);assert((await readFile(file)).equals(bytes),'CLI materialization retains exact release bytes');}
    // Revalidate live fixture history, permitting only exact previously observed
    // preparation rows in prefix order. This is a snapshot, not a deployment lock.
    const current=await ledger();
    const applied=current.filter(row=>release.pendingVersions.includes(row.version));
    assert.deepEqual(current.filter(row=>!release.pendingVersions.includes(row.version)),capturedLedger,'No unrelated ledger drift is accepted');
    assert.deepEqual(applied,firstLedger.slice(0,applied.length),'Applied release history must be the exact reviewed prefix');
    const pending=release.pendingVersions.slice(applied.length);
    assert.deepEqual(pending,expectedPending,'Only expected reviewed files remain pending');
    pendingChecks.push({installedVersions:current.map(row=>row.version),pendingVersions:pending});
   };
   const releaseArgs=args.map(arg=>arg.startsWith('--workdir=')?'--workdir='+releaseCliDirectory:arg);
   const runRelease=async(includeAll,expectedPending)=>{await validateRelease(expectedPending);return run(includeAll?[...releaseArgs,'--include-all']:releaseArgs);};
   await assert.rejects(runRelease(false,release.pendingVersions),error=>{
    const output=String(error.stdout??'')+String(error.stderr??'');
    return output.includes('Found local migration files to be inserted before the last migration on remote database')&&output.includes('--include-all');
   },'Default CLI refuses older pending migrations and points to explicit include-all');
   assert.deepEqual(await ledger(),[laterRow],'Default refusal cannot rewrite migration history');
   await preserved();await preserveLater();
   for(const name of names)assert.equal((await one('select to_regclass($1) relation',['public.'+name])).relation,null,'Default refusal does not create an older index');
   assert.equal((await q('select * from public.fixture_preparation_cli_timeouts')).rows.length,0);
   // Audit committed ledger insertion order and reject the final insert again,
   // now with a later migration already present. Rejected work must not replay it.
   await q(`create table public.fixture_preparation_cli_order(ordinal bigint generated always as identity primary key,version text not null);
    create function public.fixture_preparation_cli_order() returns trigger language plpgsql as $fixture$
    begin insert into public.fixture_preparation_cli_order(version) values(new.version);return new;end $fixture$;
    create trigger fixture_preparation_cli_order after insert on supabase_migrations.schema_migrations for each row execute function public.fixture_preparation_cli_order();
    create function public.fixture_preparation_reject_ledger() returns trigger language plpgsql as $fixture$
    begin if new.version='${functionVersion}' then raise exception 'Fixture forced function ledger failure';end if;return new;end $fixture$;
    create trigger fixture_preparation_reject_ledger before insert on supabase_migrations.schema_migrations for each row execute function public.fixture_preparation_reject_ledger()`);
   const order=async()=>(await q('select version from public.fixture_preparation_cli_order order by ordinal')).rows.map(row=>row.version);
   await assert.rejects(runRelease(true,release.pendingVersions),error=>(String(error.stdout??'')+String(error.stderr??'')).includes('Fixture forced function ledger failure'),'Explicit include-all still rolls back function and ledger together');
   assert.deepEqual((await ledger()).map(row=>row.version),[...migrations.slice(0,2).map(m=>m.name.slice(0,14)),laterVersion]);
   assert.deepEqual(await order(),migrations.slice(0,2).map(m=>m.name.slice(0,14)));
   await preserved();await preserveLater();
   await q('drop trigger fixture_preparation_reject_ledger on supabase_migrations.schema_migrations;drop function public.fixture_preparation_reject_ledger()');
   await runRelease(true,[functionVersion]);
   const olderPendingLedger=await ledger();
   assert.deepEqual(olderPendingLedger,[...firstLedger,laterRow],'Include-all applies exactly the three reviewed migrations and preserves the later row');
   const applyOrder=await order();assert.deepEqual(applyOrder,migrations.map(m=>m.name.slice(0,14)),'Only intended preparation versions apply, in order');
   await preserveLater();assert.deepEqual(await snapshot(),installed);
   const olderPendingTimeoutRows=(await q('select * from public.fixture_preparation_cli_timeouts order by identity')).rows;
   assert.deepEqual(olderPendingTimeoutRows.map(({identity,lock_seconds,statement_seconds})=>({identity,lock_seconds,statement_seconds})),names.map(name=>({identity:'public.'+name,lock_seconds:5,statement_seconds:60})).sort((a,b)=>a.identity.localeCompare(b.identity)),'Older-pending CLI builds retain exact timeout protection');
   for(const name of names)assert.deepEqual(await ready(name),{indisvalid:true,indisready:true});
   await runRelease(true,[]);await runRelease(false,[]);
   assert.deepEqual(await ledger(),olderPendingLedger);
   assert.deepEqual(await order(),applyOrder,'Neither rerun replays an already recorded migration');
   assert.deepEqual((await q('select * from public.fixture_preparation_cli_timeouts order by identity')).rows,olderPendingTimeoutRows);
   await preserveLater();assert.deepEqual(await snapshot(),installed);
   await writeFile('/tmp/icash-preparation-cli-migrations.json',JSON.stringify({scope:'Three-stage chain on captured predecessor plus one later recorded fixture migration; not full historical replay',version:'3.0.0',ledger:firstLedger,timeoutRows,olderPending:{laterRow,laterEvidence:laterBefore,ledger:olderPendingLedger,applyOrder,timeoutRows:olderPendingTimeoutRows,releaseManifest:release.manifest,pendingChecks},runs},null,2));
   // Test-only reset for the subsequent independent drift/direct-apply checks.
   await pg.exec(before.definition);await preserved();
  }finally{
   await q("drop event trigger if exists fixture_preparation_cli_timeouts;drop function if exists public.fixture_preparation_cli_timeouts();drop table if exists public.fixture_preparation_cli_timeouts;drop function if exists public.fixture_preparation_reject_ledger() cascade;drop function if exists public.fixture_preparation_cli_order() cascade;drop table if exists public.fixture_preparation_cli_order");
   await writeFile('/tmp/icash-preparation-cli-runner.json',JSON.stringify({scope:'Disposable localhost three-stage chain plus synthetic later record; no full-history or raw-repository include-all claim',runs},null,2));
   await rm(directory,{recursive:true,force:true});
  }
  console.log('PASS pinned CLI3: three-stage migration chain on captured predecessor, exact ledger SQL tokens, forced function/ledger rollback, valid indexes, preserved evidence, later-recorded default refusal/include-all order and no-op reruns. Isolated fixture only, not full-history or raw-repository release validation.');
  console.log('PASS native installation: missing/wrong/invalid index guards, canceled build residue, explicit retry rejection, concurrent receipt writer progress, sequential valid/ready indexes and transactional function-patch rollback.');
 }finally{
  await Promise.all([oldWriter.query('rollback').catch(()=>{}),freshWriter.query('rollback').catch(()=>{})]);
  if(pending)await pending.catch(()=>{});
  await Promise.all([builder.end(),oldWriter.end(),freshWriter.end()]);
 }
}
