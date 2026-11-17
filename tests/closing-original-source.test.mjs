import {PGlite} from '@electric-sql/pglite';
import {runClosingSourceFixture} from './fixtures/closing-original-source-fixture.mjs';
const db=await PGlite.create();try{await runClosingSourceFixture(db);}finally{await db.close();}
