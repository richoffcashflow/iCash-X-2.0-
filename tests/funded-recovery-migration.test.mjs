import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {assertMigrationConfig,fundedRecoveryMigrations} from './helpers/funded-recovery-migration.mjs';
for(const name of Object.keys(fundedRecoveryMigrations)){
 assertMigrationConfig(name,readFileSync(new URL('../config/'+name+'.sql',import.meta.url),'utf8'));
}
const installed={
 '20261103162508_recorded_reception_identity_backoff.sql':'9c0668303c604442f53849a1fa5b6828',
 '20261103162517_seller_opener_bounded_scan.sql':'552f34b6ff24193e9ae738ea10a211a3',
 '20261103181852_seller_opener_literal_ampersand.sql':'4f4e6942d4c70b83d296a1d8a2624e28',
 '20261103181900_text_receipt_queue_fairness.sql':'67a92da9d252c4ef4b5c57ae8f9e24a9',
 '20261103181911_owner_retry_fair_priority.sql':'a248a126df5c1199ebd9be98cd04102d',
 '20261103182413_owner_preflight_list_indexing.sql':'7b5f7082396f032f25290196ff0596b1',
 '20261103182541_owner_preflight_quota_recovery.sql':'fff3076c81122035e152aa8d356b337c',
};
for(const [file,hash] of Object.entries(installed)){
 const source=readFileSync(new URL('../supabase/migrations/'+file,import.meta.url));
 assert.equal(createHash('md5').update(source).digest('hex'),hash,'Exact production migration history: '+file);
}
assert.equal(existsSync(new URL('../supabase/migrations/20261103181214_funded_recovery_completion.sql',import.meta.url)),false,'Do not replay already installed preflight DDL');
// Supabase selects unapplied migrations by their ledger version, not by SQL
// contents or a renamed file's logical purpose. Discover the recovery files
// from disk so a stale alias or a replacement bundle cannot escape this test.
const version=file=>file.match(/^(\d{14})_/)[1];
const name=file=>file.replace(/^\d{14}_/,'').replace(/\.sql$/,'');
const pendingFiles=[fundedRecoveryMigrations['research-quota-monitoring'],fundedRecoveryMigrations['identity-bound-opportunity-buffer']];
const expectedFiles=[...Object.keys(installed),...pendingFiles].sort();
const recoveryNames=new Set([...expectedFiles.map(name),'funded_recovery_completion']);
const files=readdirSync(new URL('../supabase/migrations/',import.meta.url))
 .filter(file=>/^\d{14}_.+\.sql$/.test(file)&&recoveryNames.has(name(file))).sort();
assert.deepEqual(files,expectedFiles,'Each recovery keeps one exact migration identity, with no old aliases or replay bundle');
assert.equal(new Set(files.map(version)).size,files.length,'Recovery migration versions are unique');

// These are the seven actual installed ledger versions, including the two
// preflight installs. Other migration families are outside this focused test.
const ledger=new Set(Object.keys(installed).map(version));
const unapplied=()=>files.filter(file=>!ledger.has(version(file)));
assert.deepEqual(unapplied(),pendingFiles,'Normal version selection skips all seven installed DDL bodies and selects only the two new configs');
for(const file of unapplied()){
 assert(!Object.hasOwn(installed,file),'Never replay installed recovery DDL');
 const config=file===pendingFiles[0]?'research-quota-monitoring':'identity-bound-opportunity-buffer';
 assert.equal(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'),
  readFileSync(new URL('../config/'+config+'.sql',import.meta.url),'utf8'),'Only the exact new configuration can be selected');
}
ledger.add(version(pendingFiles[0]));
assert.deepEqual(unapplied(),[pendingFiles[1]],'Resuming after the first new migration skips it as well as the seven historical installs');
ledger.add(version(pendingFiles[1]));
assert.deepEqual(unapplied(),[],'A completed release has no recovery DDL to replay');
console.log('PASS seven exact installed migration hashes and version-ledger selection: only two new configs, safe partial resume, no installed DDL replay.');
