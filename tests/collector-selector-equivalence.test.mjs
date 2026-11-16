import {PGlite} from '@electric-sql/pglite';
import {exerciseCollectorSelector} from './helpers/collector-selector-equivalence.mjs';
const db=new PGlite();
try{console.log(JSON.stringify({result:'PASS exact synthetic collector candidate vectors',...await exerciseCollectorSelector(db)}));}
catch(error){console.error(error.stack,error.where??'');process.exitCode=1;}
finally{await db.close();}
