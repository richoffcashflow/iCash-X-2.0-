// Deterministic composition. This generates one migration, not a partial rollout.
import {readFileSync,writeFileSync} from 'node:fs';
export const ownerDemoRestartComponents=['distinct-demo-submissions','owner-demo-run-lifecycle','bot-demo-retry-accounting','owner-demo-confirmed-sender'];
export const ownerDemoRestartMigration='supabase/migrations/20261110210000_owner_demo_restart.sql';
export const componentBody=name=>{
 const sql=readFileSync(new URL('../config/'+name+'.sql',import.meta.url),'utf8');
 if((sql.match(/^begin;$/gm)||[]).length!==1||(sql.match(/^commit;$/gm)||[]).length!==1)throw new Error('Component transaction boundary changed: '+name);
 return sql.replace(/^begin;\n/m,'').replace(/^commit;\n?$/m,'').trimEnd();
};
export const buildOwnerDemoRestart=()=>[
 '-- Atomic owner demo restart: request identity, source-bound lifecycle retry accounting and sender readiness.',
 '-- Apply only this bundle after PR654, inside the caller-owned transaction.',
 '-- Supabase apply_migration owns BEGIN/body/receipt/COMMIT. For psql use --single-transaction.',
 '-- Never install the component configs separately.',...ownerDemoRestartComponents.map(n=>'\n-- BEGIN COMPONENT: '+n+'\n'+componentBody(n)+'\n-- END COMPONENT: '+n),''
].join('\n');
if(process.argv[1]===new URL(import.meta.url).pathname){const sql=buildOwnerDemoRestart();writeFileSync(new URL('../config/owner-demo-restart.sql',import.meta.url),sql);writeFileSync(new URL('../'+ownerDemoRestartMigration,import.meta.url),sql);}
