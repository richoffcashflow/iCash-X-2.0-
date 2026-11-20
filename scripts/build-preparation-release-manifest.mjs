// Disposable release-manifest prototype only. No database, credentials, CLI runner,
// reset, repair, or production installation path. Historical SQL is NEVER pending.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstat, mkdir, readdir, readFile, realpath, writeFile} from 'node:fs/promises';
import {dirname, isAbsolute, join, parse, resolve} from 'node:path';

export const PREPARATION_RELEASE = Object.freeze([
  Object.freeze({version:'20261103211342', name:'operational_preparation_phone_index', sha256:'7944d698f02155bc0e05046904e26f158037d4930f2b0278538fc8036cc1e58a'}),
  Object.freeze({version:'20261103214105', name:'operational_preparation_national_index', sha256:'cb59642006c9a2c2268dd083ff30a4a17ed451eae1c46e82f0903054fb1b687a'}),
  Object.freeze({version:'20261103214109', name:'operational_preparation_receipt_bindings', sha256:'0160f2e39f0e595cb86ea1dd3f235782d4c2116c68c3fd28658335bbb190ee84'}),
]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2)+'\n';
const filename = ({version,name}) => `${version}_${name}.sql`;
function exactKeys(value, keys, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label}: object required`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label}: unexpected or missing fields`);
}
function identity(row) {
  assert(typeof row.version === 'string' && /^\d{14}$/.test(row.version), 'Unsafe or unusual migration version');
  assert(typeof row.name === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(row.name) && row.name.length <= 180, 'Unsafe or unusual migration name');
}
export function canonicalPreparationLedger(ledgerRows) {
  assert(Array.isArray(ledgerRows) && ledgerRows.length > 0, 'Complete nonempty installed ledger required');
  const versions = new Set();
  const rows = Array.from(ledgerRows, row => {
    exactKeys(row, ['version','name','statements'], 'Ledger row'); identity(row);
    assert(!versions.has(row.version), 'Duplicate installed version'); versions.add(row.version);
    assert(Array.isArray(row.statements) && Array.from(row.statements).every(statement => typeof statement === 'string' && !statement.includes('\0') && statement.isWellFormed()), 'Exact statements[] required');
    // Duplicate historical names under distinct versions are legitimate history.
    // Preserve them; never deduplicate, rewrite versions, or synthesize no-op SQL.
    return {version:row.version, name:row.name, statements:[...row.statements]};
  });
  return rows.sort((a,b) => a.version < b.version ? -1 : a.version > b.version ? 1 : 0);
}
export function preparationLedgerSha256(ledgerRows) {
  // JSON array framing preserves statement boundaries, order, whitespace and names.
  return hash(json(canonicalPreparationLedger(ledgerRows)));
}
export function planPreparationReleaseManifest({ledgerRows, migrations}) {
  const rows = canonicalPreparationLedger(ledgerRows);
  assert(Array.isArray(migrations) && migrations.length === PREPARATION_RELEASE.length, 'Exactly three pending migrations required');
  const pending = new Map();
  for (const migration of migrations) {
    exactKeys(migration, ['version','name','bytes'], 'Pending migration'); identity(migration);
    assert(Buffer.isBuffer(migration.bytes) || migration.bytes instanceof Uint8Array, 'Explicit migration bytes required');
    const pinned = PREPARATION_RELEASE.find(row => row.version === migration.version && row.name === migration.name);
    assert(pinned, 'Unexpected pending migration identity');
    assert(!pending.has(migration.version), 'Duplicate pending version/name');
    const bytes = Buffer.from(migration.bytes);
    assert.equal(hash(bytes), pinned.sha256, 'Pending migration bytes differ from reviewed release');
    assert(!rows.some(row => row.version === migration.version || row.name.toLowerCase() === migration.name.toLowerCase()), 'Pending/installed scope collision');
    pending.set(migration.version, bytes);
  }
  const files = new Map();
  const installed = rows.map(row => {
    // Ledger stores statements, not original file bytes. Delimit without trimming
    // or SQL normalization. These files exist ONLY to match already-applied versions.
    const bytes = Buffer.from(row.statements.join('\n;\n'), 'utf8');
    const path = 'migrations/'+filename(row); files.set(path, bytes);
    return {version:row.version,name:row.name,statements:row.statements,path,sha256:hash(bytes),role:'already-applied-never-execute'};
  });
  const newMigrations = PREPARATION_RELEASE.map(row => {
    const path = 'migrations/'+filename(row); const bytes = pending.get(row.version);
    assert(bytes, 'Missing pinned pending migration'); files.set(path, bytes);
    return {...row,path,role:'pending'};
  });
  const manifest = {format:'icash-preparation-release-manifest-v1', purpose:'disposable-verification-only',
    ledgerSha256:preparationLedgerSha256(rows), installed, pending:newMigrations};
  files.set('manifest.json', Buffer.from(json(manifest)));
  return {manifest,files,ledgerSha256:manifest.ledgerSha256,pendingVersions:newMigrations.map(row=>row.version)};
}
async function safeDirectoryPath(path) {
  assert(typeof path === 'string' && isAbsolute(path), 'Absolute directory path required');
  assert(!path.split(/[\\/]/).includes('..'), 'Directory traversal refused');
  const absolute=resolve(path); let cursor=parse(absolute).root;
  for (const part of absolute.slice(cursor.length).split('/').filter(Boolean)) {
    cursor=join(cursor,part); const stat=await lstat(cursor);
    assert(stat.isDirectory() && !stat.isSymbolicLink(), 'Directory symlink or non-directory refused');
  }
  assert.equal(await realpath(absolute),absolute,'Directory aliases refused');
  return absolute;
}
export async function buildPreparationReleaseManifest({ledgerRows,migrations,outputDirectory}) {
  const plan=planPreparationReleaseManifest({ledgerRows,migrations});
  assert(typeof outputDirectory==='string' && isAbsolute(outputDirectory) && !outputDirectory.split(/[\\/]/).includes('..'), 'Safe absolute fresh output directory required');
  await safeDirectoryPath(dirname(outputDirectory));
  // No recursive creation or overwriting: an existing destination is always refused.
  await mkdir(outputDirectory,{mode:0o700});
  await mkdir(join(outputDirectory,'migrations'),{mode:0o700});
  for (const [path,bytes] of plan.files) await writeFile(join(outputDirectory,path),bytes,{flag:'wx',mode:0o600});
  await validatePreparationReleaseManifest({directory:outputDirectory,ledgerRows,migrations,expectedLedgerSha256:plan.ledgerSha256});
  return {directory:resolve(outputDirectory),manifest:plan.manifest,ledgerSha256:plan.ledgerSha256,pendingVersions:plan.pendingVersions};
}
export async function validatePreparationReleaseManifest({directory,ledgerRows,migrations,expectedLedgerSha256}) {
  assert(typeof expectedLedgerSha256==='string' && /^[a-f0-9]{64}$/.test(expectedLedgerSha256), 'Out-of-band original ledger hash required');
  const plan=planPreparationReleaseManifest({ledgerRows,migrations});
  assert.equal(plan.ledgerSha256,expectedLedgerSha256,'Installed ledger changed since snapshot');
  const root=await safeDirectoryPath(directory);
  assert.deepEqual((await readdir(root)).sort(),['manifest.json','migrations'],'Unexpected or missing release files');
  await safeDirectoryPath(join(root,'migrations'));
  const expected=[...plan.files.keys()].filter(path=>path.startsWith('migrations/')).map(path=>path.slice(11)).sort();
  assert.deepEqual((await readdir(join(root,'migrations'))).sort(),expected,'Unexpected or missing migration files');
  for (const [path,bytes] of plan.files) {
    const target=join(root,path); const stat=await lstat(target);
    assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink===1,'Symlink, hardlink or non-file refused');
    assert(bytes.equals(await readFile(target)),`Release bytes changed: ${path}`);
  }
  // The expected hash must be retained outside this directory by the caller.
  // Validation is a snapshot, NOT a lock against concurrent DB/filesystem mutation.
  return {ledgerSha256:plan.ledgerSha256,installedVersions:plan.manifest.installed.map(row=>row.version),pendingVersions:plan.pendingVersions};
}
