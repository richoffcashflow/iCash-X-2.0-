import {PGlite} from '@electric-sql/pglite';
import {runTitleNegatedReview} from './fixtures/title-negated-review-fixture.mjs';
const db=new PGlite();
try{await runTitleNegatedReview(db);}finally{await db.close();}
