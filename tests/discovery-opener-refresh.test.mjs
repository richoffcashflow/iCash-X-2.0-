import {createRequire} from 'node:module';
import {createDiscoveryOpenerRefreshFixture} from './helpers/discovery-opener-refresh-fixture.mjs';
import {verifyDiscoveryOpenerRefresh} from './helpers/discovery-opener-refresh-assertions.mjs';
const f=await createDiscoveryOpenerRefreshFixture(createRequire(import.meta.url).resolve('@electric-sql/pglite'));
try{console.log('PASS discovery opener refresh',await verifyDiscoveryOpenerRefresh(f));}catch(error){console.error(error.message,error.cause?.where??error.where??'');process.exitCode=1;}finally{await f.pg.close();}
