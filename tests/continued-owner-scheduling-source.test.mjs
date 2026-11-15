import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const sql=read('config/continued-owner-scheduling.sql');
assert.equal(sql,read('supabase/migrations/20261115134000_continued_owner_scheduling.sql'));
const sources=JSON.parse(read('tests/fixtures/continued-owner-scheduling-before.json'));
assert.equal(sources.length,5);
for(const source of sources){
 const name=source.signature.slice(0,source.signature.indexOf('('));
 const signature={
  'public.icash_continued_owner_preflight':'public.icash_continued_owner_preflight(uuid,uuid,jsonb,boolean)',
  'public.icash_owner_enrichment_retry_current':'public.icash_owner_enrichment_retry_current(uuid,uuid)',
  'public.icash_enrichment_before_prospecting_budget':'public.icash_enrichment_before_prospecting_budget(uuid)',
  'public.icash_next_acquisition':'public.icash_next_acquisition()',
  'icash_work_private.record_continuation_decision':'icash_work_private.record_continuation_decision(uuid,uuid,uuid,boolean)',
 }[name];
 assert(signature,'Unexpected captured function');
 const hash=createHash('md5').update(source.definition).digest('hex');
 assert(sql.includes("('"+signature+"','"+hash+"')"),'Migration must pin the exact independently captured predecessor: '+signature);
}
console.log('PASS continued-owner scheduling migration identity and exact captured predecessor pins; behavioral and race proof run in the actual-selector suites.');
