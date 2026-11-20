import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm,symlink,link,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PREPARATION_RELEASE,canonicalPreparationLedger,preparationLedgerSha256,planPreparationReleaseManifest,buildPreparationReleaseManifest,validatePreparationReleaseManifest} from '../scripts/build-preparation-release-manifest.mjs';
const repo=fileURLToPath(new URL('../',import.meta.url));
const migrations=await Promise.all(PREPARATION_RELEASE.map(async ({version,name})=>({version,name,bytes:await readFile(join(repo,'supabase','migrations',`${version}_${name}.sql`))})));
const fixture=()=>Array.from({length:645},(_,i)=>({version:String(20260101000000n+BigInt(i)),name:i<2?'historical_duplicate_name':`historical_${i}`,statements:i===2?[]:[`-- installed ${i}\nselect '${i};literal';`, `do $body$ begin perform 'a\nb'; end $body$;`]}));
const clone=value=>structuredClone(value);
const plan=(ledgerRows=fixture(),pending=migrations)=>planPreparationReleaseManifest({ledgerRows,migrations:pending});
async function artifact(t) {
 const root=await mkdtemp(join(tmpdir(),'preparation-release-manifest-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const ledgerRows=fixture(); const directory=join(root,'release');
 const result=await buildPreparationReleaseManifest({ledgerRows,migrations,outputDirectory:directory});
 const check=(extra={})=>validatePreparationReleaseManifest({directory,ledgerRows,migrations,expectedLedgerSha256:result.ledgerSha256,...extra});
 return {root,directory,ledgerRows,result,check};
}
test('645 installed rows preserved exactly; only reviewed three pending, deterministic bytes and metadata',()=>{
 const rows=fixture(), p=plan(rows), reversed=plan([...rows].reverse(),[...migrations].reverse());
 assert.equal(p.manifest.installed.length,645); assert.equal(p.files.size,649);
 assert.deepEqual(p.manifest.installed.map(({version,name,statements})=>({version,name,statements})),rows);
 assert.deepEqual(p.pendingVersions,PREPARATION_RELEASE.map(row=>row.version));
 assert.equal(p.manifest.installed[0].name,p.manifest.installed[1].name);
 assert.notEqual(p.manifest.installed[0].path,p.manifest.installed[1].path);
 assert.equal(p.manifest.installed[2].statements.length,0);
 assert.equal(p.files.get(p.manifest.installed[2].path).length,0);
 assert.deepEqual(p.files,reversed.files);
 for(const migration of migrations) assert.deepEqual(p.files.get(`migrations/${migration.version}_${migration.name}.sql`),migration.bytes);
 assert(p.manifest.installed.every(row=>row.role==='already-applied-never-execute'));
 assert.equal(p.manifest.purpose,'disposable-verification-only');
});
test('snapshots preserve SQL array boundaries, whitespace, order and metadata',()=>{
 const rows=fixture(), original=preparationLedgerSha256(rows);
 for(const mutate of [r=>r[0].statements.reverse(),r=>r[0].statements=[r[0].statements.join('\n;\n')],r=>r[0].statements[0]+=' ',r=>r[0].name+='x',r=>r.pop(),r=>r.push({version:'20261103220000',name:'later',statements:[]})]) {
  const changed=clone(rows); mutate(changed); assert.notEqual(preparationLedgerSha256(changed),original);
 }
 const p=plan(rows);rows[0].statements[0]='changed';assert.notEqual(p.manifest.installed[0].statements[0],'changed');
});
const invalidLedgerCases={
 empty:r=>r.splice(0), sparseRow:r=>delete r[0], sparseStatements:r=>r[0].statements=Array(2), malformedUnicode:r=>r[0].statements=['\ud800'], duplicateVersion:r=>r.push(clone(r[0])), missingName:r=>delete r[0].name, emptyName:r=>r[0].name='', nullName:r=>r[0].name=null,
 traversal:r=>r[0].name='../evil', slash:r=>r[0].name='a/b', backslash:r=>r[0].name='a\\b', newline:r=>r[0].name='evil\n.sql', extension:r=>r[0].name='other.sql', leadingDash:r=>r[0].name='-flag',
 invalidVersion:r=>r[0].version='../202611030000', numericVersion:r=>r[0].version=20261103000000,
 missingStatements:r=>delete r[0].statements, nullStatements:r=>r[0].statements=null, stringStatements:r=>r[0].statements='select 1', nullStatement:r=>r[0].statements=[null], nulStatement:r=>r[0].statements=['select\0'], extraFields:r=>r[0].unexpected='data',
 versionCollision:r=>r[0].version=PREPARATION_RELEASE[0].version, nameCollision:r=>r[0].name=PREPARATION_RELEASE[0].name, caseCollision:r=>r[0].name=PREPARATION_RELEASE[0].name.toUpperCase(),
};
for(const [name,mutate] of Object.entries(invalidLedgerCases)) test(`fail closed on ledger ${name}`,()=>{const rows=fixture();mutate(rows);assert.throws(()=>plan(rows));});
for(const [name,mutate] of Object.entries({missing:m=>m.pop(),extra:m=>m.push(clone(m[0])),duplicate:m=>m[1]=clone(m[0]),newIdentity:m=>m[0].name='unreviewed',newVersion:m=>m[0].version='20261103220000',modified:m=>m[0].bytes=Buffer.concat([m[0].bytes,Buffer.from('\n')]),stringSQL:m=>m[0].bytes=m[0].bytes.toString(),extraField:m=>m[0].sql='select 1',pathTraversal:m=>m[0].name='../evil'})) test(`fail closed on pending ${name}`,()=>{const m=migrations.map(row=>({...row,bytes:Buffer.from(row.bytes)}));mutate(m);assert.throws(()=>plan(fixture(),m));});
test('fresh artifact validates exact installed and pending sets; existing destination refused',async t=>{
 const a=await artifact(t); const result=await a.check();
 assert.equal(result.installedVersions.length,645);assert.deepEqual(result.pendingVersions,PREPARATION_RELEASE.map(r=>r.version));
 await assert.rejects(buildPreparationReleaseManifest({ledgerRows:a.ledgerRows,migrations,outputDirectory:a.directory}),{code:'EEXIST'});
 await a.check();
});
for(const [name,mutate] of Object.entries({missing:r=>r.pop(),addition:r=>r.push({version:'20261103220000',name:'later',statements:[]}),sql:r=>r[0].statements[0]+=' ',name:r=>r[0].name+='x',boundaries:r=>r[0].statements=[r[0].statements.join('\n;\n')]}))test(`later reread rejects ledger ${name}`,async t=>{const a=await artifact(t);const rows=clone(a.ledgerRows);mutate(rows);await assert.rejects(a.check({ledgerRows:rows}),/ledger changed/);});
test('out-of-band snapshot required; edited manifest cannot approve new ledger',async t=>{
 const a=await artifact(t);await assert.rejects(a.check({expectedLedgerSha256:undefined}),/Out-of-band/);
 const changed=clone(a.ledgerRows);changed[0].statements[0]='select 99;';
 const forged=plan(changed);await writeFile(join(a.directory,'manifest.json'),forged.files.get('manifest.json'));
 await assert.rejects(a.check({ledgerRows:changed}),/ledger changed/);
 await assert.rejects(a.check(),/bytes changed/);
});
for(const [name,mutate] of Object.entries({
 extraRoot:async a=>writeFile(join(a.directory,'config.toml'),'unexpected'),
 extraPending:async a=>writeFile(join(a.directory,'migrations','20261103220000_rogue.sql'),'select 1;'),
 missingSQL:async a=>rm(join(a.directory,'migrations',`${PREPARATION_RELEASE[0].version}_${PREPARATION_RELEASE[0].name}.sql`)),
 changedSQL:async a=>writeFile(join(a.directory,'migrations',`${PREPARATION_RELEASE[0].version}_${PREPARATION_RELEASE[0].name}.sql`),'select 1;'),
 changedHistory:async a=>writeFile(join(a.directory,'migrations',`${a.ledgerRows[0].version}_${a.ledgerRows[0].name}.sql`),'select 1;'),
 changedManifest:async a=>writeFile(join(a.directory,'manifest.json'),'{}'),
 directoryInsteadOfFile:async a=>{await rm(join(a.directory,'manifest.json'));await mkdir(join(a.directory,'manifest.json'));},
 symlinkFile:async a=>{const p=join(a.directory,'manifest.json');await rename(p,join(a.root,'other.json'));await symlink(join(a.root,'other.json'),p);},
 hardlinkFile:async a=>link(join(a.directory,'manifest.json'),join(a.root,'alias.json')),
 symlinkMigrations:async a=>{await rename(join(a.directory,'migrations'),join(a.root,'other'));await symlink(join(a.root,'other'),join(a.directory,'migrations'));},
 nestedUnexpected:async a=>mkdir(join(a.directory,'migrations','nested')),
}))test(`directory tampering rejected: ${name}`,async t=>{const a=await artifact(t);await mutate(a);await assert.rejects(a.check());});
test('symlink root and ancestors, relative paths and traversal refused',async t=>{
 const a=await artifact(t);const alias=join(a.root,'alias');await symlink(a.directory,alias);
 await assert.rejects(a.check({directory:alias}),/symlink/);
 await assert.rejects(a.check({directory:join(a.root,'alias','migrations')}));
 await assert.rejects(a.check({directory:'relative'}),/Absolute/);
 await assert.rejects(a.check({directory:a.directory+'/../release'}),/traversal/);
 await assert.rejects(buildPreparationReleaseManifest({ledgerRows:a.ledgerRows,migrations,outputDirectory:join(alias,'new')}),/symlink/);
});
test('invalid input does not create an output directory',async t=>{
 const root=await mkdtemp(join(tmpdir(),'preparation-invalid-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const outputDirectory=join(root,'no-output');await assert.rejects(buildPreparationReleaseManifest({ledgerRows:[],migrations,outputDirectory}));
 await assert.rejects(readFile(outputDirectory),{code:'ENOENT'});
});
