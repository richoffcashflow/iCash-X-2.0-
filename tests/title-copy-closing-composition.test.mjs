import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {installTitleCopyClosingFixture} from './fixtures/title-copy-closing-fixture.mjs';
import {sendTitleCopyReply} from './fixtures/title-copy-fixture.mjs';
import {recordConfirmation,confirmation} from './fixtures/closing-original-source-fixture.mjs';
const db=new PGlite();
try{
 const {first,second}=await installTitleCopyClosingFixture(db);
 const r=await sendTitleCopyReply(db,first,'Please send the purchase agreement.');
 const task=(await db.query("select * from public.icash_title_tasks where reply_id=$1 and kind='document_update'",[r.id])).rows[0];assert(task);
 await db.exec('set role service_role');
 await recordConfirmation(db,first,confirmation({date:await first.date(),agreement:first.assignment}));
 await db.exec('reset role');
 assert.equal((await first.state()).deal.stage,'closed','Current guarded confirmation remains functional with both insert locks');
 assert.equal((await db.query('select state from public.icash_title_tasks where id=$1',[task.id])).rows[0].state,'cancelled');
 assert.equal((await db.query('select count(*)::int n from public.icash_operation_spend where operation_key=$1',['title-followup:'+task.id])).rows[0].n,0);
 await db.exec('set role service_role');
 await recordConfirmation(db,second,confirmation({date:await second.date(),agreement:second.assignment}),{source:{providerReceivedAt:'2000-01-01T00:00:00Z'}});
 await db.exec('reset role');assert.equal((await second.state()).deal.stage,'title_open','Copy adapter never revives stale closing authority');
 console.log('PASS composed actual title source, copy and closing triggers: lock order preserves current confirmations, terminal cancellation of unsent copies and stale-closing holds.');
}finally{await db.close();}
