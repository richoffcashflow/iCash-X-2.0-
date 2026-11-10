import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {buildOwnerDemoRestart,componentBody,ownerDemoRestartComponents,ownerDemoRestartMigration} from '../../scripts/build-owner-demo-restart.mjs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export function assertOwnerDemoRestartParity(component){
 const sql=read('config/owner-demo-restart.sql');assert.equal(sql,buildOwnerDemoRestart());assert.equal(sql,read(ownerDemoRestartMigration));
 assert(ownerDemoRestartComponents.includes(component));assert(sql.includes('-- BEGIN COMPONENT: '+component+'\n'+componentBody(component)+'\n-- END COMPONENT: '+component));
 const forbidden=/_((distinct_demo_submissions)|(owner_demo_run_lifecycle)|(owner_demo_confirmed_sender))\.sql$/;
 assert(!readdirSync(new URL('../../supabase/migrations/',import.meta.url)).some(n=>forbidden.test(n)),'No independently activatable partial migration');
 assert.equal((sql.match(/^begin;$/gm)||[]).length,0);assert.equal((sql.match(/^commit;$/gm)||[]).length,0);
}
