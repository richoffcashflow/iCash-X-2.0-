import {PGlite} from '@electric-sql/pglite';
import {rehearseContinuedOwnerHandler} from './helpers/continued-owner-handler-rehearsal.mjs';
const pg=new PGlite();
try{await rehearseContinuedOwnerHandler(pg);}catch(error){console.error(error.stack,error.where??'');process.exitCode=1;}finally{await pg.close();}
