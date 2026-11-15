import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {installFixture,verifyIsolation,migration,read} from './helpers/research-capacity-isolation-fixture.mjs';
assert.equal(migration,read('supabase/migrations/20261115230153_research_capacity_isolation.sql'));
const db=new PGlite();
try{
 await installFixture(db);
 console.log('Research capacity isolation PASS',await verifyIsolation(db));
}finally{await db.close();}
