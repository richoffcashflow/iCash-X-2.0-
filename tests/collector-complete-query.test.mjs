import {PGlite} from '@electric-sql/pglite';
import {exerciseCompleteCollector} from './helpers/collector-complete-query-fixture.mjs';
const db=new PGlite();
try{console.log(JSON.stringify({result:'PASS complete synthetic collector equivalence',...await exerciseCompleteCollector(db)}));}
catch(error){console.error(error.stack,error.where??'');process.exitCode=1;}
finally{await db.close();}
