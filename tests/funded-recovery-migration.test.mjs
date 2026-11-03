import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
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
console.log('PASS seven installed migration hashes match production and both pending recovery changes remain independently deployable.');
