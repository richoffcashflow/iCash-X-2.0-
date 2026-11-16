import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {setup,migration} from './helpers/seller-memory-receipt-fixture.mjs';
import {baseline,cases} from './helpers/seller-memory-receipt-cases.mjs';
globalThis.fetch=async()=>{throw Error('NO NETWORK: fictional fixtures only');};
assert.equal(migration,readFileSync(new URL('../supabase/migrations/20261116225713_seller_memory_receipt_time.sql',import.meta.url),'utf8'));
assert(!/^\s*(?:begin|commit);/im.test(migration),'migration caller owns transaction');
const pg=await PGlite.create();try{await setup(pg);await baseline(pg);await cases(pg);}finally{await pg.close();}
console.log('PASS shared seller memory receipt chronology, ambiguous boundaries, later clarification, source caps, immutable fingerprints, isolation and actual old application. No provider calls.');
