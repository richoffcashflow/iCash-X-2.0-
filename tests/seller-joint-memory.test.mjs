import {PGlite} from '@electric-sql/pglite';
import {setup,cases,directCases} from './helpers/seller-joint-memory-fixture.mjs';
globalThis.fetch=async()=>{throw Error('NO NETWORK: actual ordered seller SQL composition only');};
const pg=await PGlite.create();try{await setup(pg);await cases(pg);await directCases(pg);}finally{await pg.close();}
console.log('PASS actual receipt → atomic admission → whole raw source → canonical TS → direct and deferred agreement composition. Provider and financial boundaries remain explicit fictional sentinels.');
