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
 '20261103183354_research_quota_monitoring.sql':'7aa29388c804ec3f2921cf81392673f9',
 '20261103183400_identity_bound_opportunity_buffer.sql':'9d0b14e056a0c702988f004d979e051f',
 '20261103183653_research_quota_minimum_capacity.sql':'1c053b4d0284a03007a78f3661713feb',
 '20261103184920_urgent_voice_source_gate.sql':'d54d8ff08ce066c6f3c27489692dcce2',
 '20261103191344_legacy_voice_candidate_fence.sql':'bca111eeb7af2a24fb83af89c3f40162',
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
const followUp=fundedRecoveryMigrations['research-quota-minimum-capacity'];
const expectedFiles=Object.keys(installed).sort();
const recoveryNames=new Set([...expectedFiles.map(name),'funded_recovery_completion']);
const files=readdirSync(new URL('../supabase/migrations/',import.meta.url))
 .filter(file=>/^\d{14}_.+\.sql$/.test(file)&&recoveryNames.has(name(file))).sort();
assert.deepEqual(files,expectedFiles,'Each recovery keeps one exact migration identity, with no old aliases or replay bundle');
assert.equal(new Set(files.map(version)).size,files.length,'Recovery migration versions are unique');

// These are the twelve actual installed ledger versions. Other migration
// families are outside this focused test.
const ledger=new Set(Object.keys(installed).map(version));
const unapplied=()=>files.filter(file=>!ledger.has(version(file)));
assert.deepEqual(unapplied(),[],'The current production ledger selects no recovery DDL for replay');
ledger.delete(version(followUp));
assert.deepEqual(unapplied(),[followUp],'A ledger missing only the diagnostic selects only that guarded follow-up');
ledger.delete('20261103183400');
assert.deepEqual(unapplied(),[fundedRecoveryMigrations['identity-bound-opportunity-buffer'],followUp],'A partial earlier installation skips the immutable original monitor');
ledger.add('20261103183400');
assert.deepEqual(unapplied(),[followUp],'Resuming the earlier installation leaves only the guarded diagnostic');
ledger.add(version(followUp));
assert.deepEqual(unapplied(),[],'A completed release has no recovery DDL to replay');
console.log('PASS twelve exact installed migration hashes and version-ledger selection: no pending recovery DDL, safe earlier partial resume, no installed DDL replay.');
