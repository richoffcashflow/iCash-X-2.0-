import {PGlite} from '@electric-sql/pglite';
import {runTitleDeliveryFixture} from './fixtures/title-delivery-fixture.mjs';
const db=await PGlite.create();try{await runTitleDeliveryFixture(db);}finally{await db.close();}
