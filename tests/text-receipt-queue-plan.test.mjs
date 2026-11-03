import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=await PGlite.create();
const nodes=plan=>[plan,...(plan.Plans??[]).flatMap(nodes)];
try{
 await pg.exec(read('tests/fixtures/text-delivery-recovery-base.sql'));
 await pg.exec(read('tests/fixtures/text-delivery-recovery-observers.sql'));
 for(const x of JSON.parse(read('tests/fixtures/text-delivery-recovery-triggers.json')))await pg.exec(x.function_definition+';'+x.definition+';');
 for(const path of ['config/text-delivery-recovery.sql','tests/fixtures/text-receipt-fairness-seed.sql','config/text-receipt-queue-fairness.sql'])await pg.exec(read(path));
 await pg.exec('select fixture_receipt_seed(100,200);select fixture_receipt_seed(1000,1000,1);select fixture_receipt_seed(10000,5000,8);analyze;');
 const query=read('config/text-receipt-queue-fairness.sql').split('with due as materialized (\n')[1].split('\n  ), fresh')[0];
 const previous=query.replace('join icash_text_receipt_private.schedule s','left join icash_text_receipt_private.schedule s')
  .replace('s.attempts<8 and s.next_check_at<=now()','coalesce(s.attempts,0)<8 and (s.next_check_at is null or s.next_check_at<=now())');
 const explain=async sql=>(await pg.query('explain(analyze,buffers,format json) '+sql)).rows[0]['QUERY PLAN'][0];
 const before=await explain(previous),after=await explain(query);
 assert(!nodes(before.Plan).some(n=>n['Index Name']==='icash_text_receipt_schedule_due'),'Reproduce unprovable coalesce partial-index predicate');
 assert(nodes(after.Plan).some(n=>n['Index Name']==='icash_text_receipt_schedule_due'),'Default planner must use the non-exhausted due index');
 assert.deepEqual((await pg.query(query)).rows,(await pg.query(previous)).rows,'Inner due join and explicit nonnullable predicates preserve exact eligible sources');
 assert.equal(after.Plan['Actual Rows'],3);
 console.log(`PASS due receipt plan: partial index selected; same original sources; fixture buffer hits ${before.Plan['Shared Hit Blocks']}→${after.Plan['Shared Hit Blocks']} with 5,000 exhausted checks excluded.`);
}finally{await pg.close();}
