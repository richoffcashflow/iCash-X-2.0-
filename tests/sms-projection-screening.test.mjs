import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {install,verify,read,migration} from './helpers/sms-projection-screening-fixture.mjs';
const name=readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(n=>n.endsWith('_sms_projection_screening.sql'));
assert.equal(read('supabase/migrations/'+name),migration);
const db=await PGlite.create();
try{await install(db);console.log('SMS projection screening PASS',await verify(db));}finally{await db.close();}
