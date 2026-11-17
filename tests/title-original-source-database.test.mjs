import {PGlite} from '@electric-sql/pglite';
import {runOriginalSourceFixture} from './fixtures/title-original-source-fixture.mjs';
const db=new PGlite();
try{await runOriginalSourceFixture(db);}catch(e){console.error(e.message,e.code,e.where);process.exitCode=1;}finally{await db.close();}
