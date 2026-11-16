import {PGlite} from '@electric-sql/pglite';
import {baseSql,stepSql,continuationSql,checkingSql} from './helpers/owner-expired-checking-fixture.mjs';
import {rehearseRecoveryStageUpgrade} from './helpers/owner-recovery-stage-rehearsal.mjs';
const pg=new PGlite();
try{
 await pg.exec(baseSql);
 await rehearseRecoveryStageUpgrade(pg,{stepSql,continuationSql,checkingSql});
 console.log('PASS recovery-stage upgrade: all 86 historical stage rows preserved; exact validated predecessor; original 23514 reproduced; committed disabled stage one survives stage-two and stage-three ledger failures; ordered resume installs disabled without replay.');
}finally{await pg.close();}
