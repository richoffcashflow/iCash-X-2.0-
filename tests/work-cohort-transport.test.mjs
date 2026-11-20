import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,chmodSync,statSync,existsSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createObservation,renderCohortQuery} from '../scripts/work-cohort.mjs';
import {FORMAT,MAX_RAW_BYTES,MAX_ENCRYPTED_BYTES,renderTransportQuery,createTransportManifest,verifyTransportSources,validateEnvelope,verifyPlaintext,transportCli} from '../scripts/work-cohort-transport.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/work-cohort-transport.json',import.meta.url),'utf8'));
const {baseline,key,plaintext,envelope}=fixture,bytes=Buffer.from(plaintext),baselineBytes=Buffer.from(JSON.stringify(baseline));
const sha=x=>createHash('sha256').update(x).digest('hex');
const original=renderCohortQuery(baseline),sql=renderTransportQuery(baseline,key),manifest=createTransportManifest(baselineBytes,key);
const body=original.slice(original.indexOf('with fixed_members'),original.lastIndexOf(';\ncommit;'));
assert(sql.includes('complete_observation as materialized (\n'+body+'\n)'), 'Complete original query retained byte-for-byte');
assert.equal(sql.split(body).length,2,'Exact original read executes once');
assert.equal((sql.match(/begin read only;/g)??[]).length,1);assert.equal((sql.match(/statement_timeout='20s'/g)??[]).length,1);
assert.equal((sql.match(/\bcommit;/g)??[]).length,1);
assert(!/\b(?:create|insert|update|delete|truncate|call|execute|pg_sleep)\b/i.test(sql));
assert(sql.includes("compress-algo=2,compress-level=6,cipher-algo=aes256"));
assert(sql.includes("convert_to(json_agg(complete_observation order by evidence->>'id')::text,'UTF8')"));
assert.equal(manifest.querySha256,sha(original));
assert.deepEqual(verifyTransportSources(baselineBytes,key,Buffer.from(sql),manifest),baseline);
assert.throws(()=>verifyTransportSources(Buffer.from(JSON.stringify({...baseline,cohortId:'changed'})),key,Buffer.from(sql),manifest),/SOURCE_CHANGED/);
assert.throws(()=>verifyTransportSources(baselineBytes,'f'.repeat(64),Buffer.from(sql),manifest),/SOURCE_CHANGED/);
assert.throws(()=>verifyTransportSources(baselineBytes,key,Buffer.from(sql+'\n'),manifest),/QUERY_CHANGED/);
assert.throws(()=>renderTransportQuery(baseline,"bad'key"),/INVALID_EPHEMERAL_KEY/);
assert.throws(()=>renderTransportQuery({accounts:[baseline.accounts[0],baseline.accounts[0]]},key),/INVALID_FIXED_COHORT/);
const receipt=verifyPlaintext(baseline,envelope,bytes);
assert.equal(receipt.rawBytes,bytes.length);assert.equal(receipt.plaintextSha256,sha(bytes));assert.equal(receipt.observationAppended,false);
assert.equal(receipt.observedAt,JSON.parse(plaintext)[0].observed_at);
assert.deepEqual(validateEnvelope(baseline,[envelope]),validateEnvelope(baseline,envelope),'One database result row is accepted');
assert.throws(()=>validateEnvelope(baseline,[envelope,envelope]),/ENVELOPE/);
for(const patch of [
 {format:'unknown'},{query_sha256:'0'.repeat(64)},{membership_sha256:'0'.repeat(64)},
 {row_count:1},{distinct_member_count:1},{raw_bytes:0},{raw_bytes:MAX_RAW_BYTES+1},{raw_bytes:1.5},
 {encrypted_bytes:MAX_ENCRYPTED_BYTES+1},{encrypted_bytes:envelope.encrypted_bytes+1},
 {plaintext_sha256:'not-a-hash'},{encrypted_base64:envelope.encrypted_base64.slice(0,-4)},
 {encrypted_base64:'!!!!'},{original_observed_at_max:'2026-11-15T00:00:00.000001Z'},
 {original_observed_at_min:'2026-02-30T00:00:00Z'},
])assert.throws(()=>validateEnvelope(baseline,{...envelope,...patch}));
assert.throws(()=>verifyPlaintext(baseline,{...envelope,plaintext_sha256:'0'.repeat(64)},bytes),/INTEGRITY/);
assert.throws(()=>verifyPlaintext(baseline,envelope,Buffer.concat([bytes,Buffer.from('\n')])),/INTEGRITY/);
const testRows=(rows,pattern)=>{
 const changed=Buffer.from(JSON.stringify(rows));
 assert.throws(()=>verifyPlaintext(baseline,{...envelope,raw_bytes:changed.length,plaintext_sha256:sha(changed)},changed),pattern);
};
const rows=JSON.parse(plaintext);
assert.equal(rows[1].evidence.diagnostic_text,'Café 雪\r\nsecond\nline');
assert(bytes.length>plaintext.length,'UTF8 byte counts are not JavaScript character counts');
const nextMicrosecond=rows[0].observed_at.replace('.123456','.123457');
assert.notEqual(nextMicrosecond,rows[0].observed_at);
assert.throws(()=>validateEnvelope(baseline,{...envelope,original_observed_at_max:nextMicrosecond}),/TIME_MISMATCH/);
testRows(rows.slice(0,1),/ROW_COUNT/);
testRows([rows[0],rows[0]],/MEMBERSHIP/);
testRows([rows[0],{...rows[1],evidence:{...rows[1].evidence,id:'00000000-0000-4000-8000-000000000999'}}],/MEMBERSHIP/);
testRows([rows[0],{...rows[1],observed_at:nextMicrosecond}],/MIXED/);
testRows(rows.map(row=>({...row,observed_at:nextMicrosecond})),/ORIGINAL_TIME/);
testRows([{...rows[0],rewritten:true},rows[1]],/SHAPE/);
const invalidUtf8=Buffer.from([0xff]);
assert.throws(()=>verifyPlaintext(baseline,{...envelope,raw_bytes:1,plaintext_sha256:sha(invalidUtf8)},invalidUtf8),/INVALID_JSON/);
// Transport must not change classification, raw receipts, missing timing or gaps.
const before=createObservation(baseline,rows),after=createObservation(baseline,JSON.parse(bytes.toString('utf8')));
assert.deepEqual(after,before);assert.equal(after.payload.continuousZeroStallStreak,null);
const oldRows=rows.map(row=>({...row,observed_at:'2026-11-01T00:00:00Z'}));
assert.equal(createObservation(baseline,rows,createObservation(baseline,oldRows)).payload.observationGap,true);
const home=mkdtempSync(join(tmpdir(),'cohort-transport-test-'));
try{
 const b=join(home,'baseline.json'),k=join(home,'key'),q=join(home,'read.sql');
 writeFileSync(b,baselineBytes,{mode:0o600});assert.deepEqual(transportCli(['key',k]),{keyCreated:true});
 assert.match(readFileSync(k,'utf8'),/^[a-f0-9]{64}\n$/);assert.equal(statSync(k).mode&0o077,0);
 assert.throws(()=>transportCli(['key',k]),/EEXIST/);
 const rendered=transportCli(['sql',b,k,q]);assert.equal(rendered.sqlCreated,true);
 for(const path of [q,q+'.manifest.json'])assert.equal(statSync(path).mode&0o077,0);
 assert.throws(()=>transportCli(['sql',b,k,q]),/EEXIST/);
 assert.equal(readFileSync(b).toString(),baselineBytes.toString(),'Baseline is never rewritten');
 chmodSync(b,0o644);assert.throws(()=>transportCli(['sql',b,k,join(home,'leak.sql')]),/PRIVATE_FILE/);chmodSync(b,0o600);
 symlinkSync(b,join(home,'linked-baseline'));assert.throws(()=>transportCli(['sql',join(home,'linked-baseline'),k,join(home,'link.sql')]),/SYMLINK/);
 assert.throws(()=>transportCli(['key','relative-key']),/ABSOLUTE_PRIVATE_PATH/);
 chmodSync(home,0o755);assert.throws(()=>transportCli(['key',join(home,'unsafe-key')]),/PRIVATE_OUTPUT_DIRECTORY/);chmodSync(home,0o700);
 assert(!existsSync(join(home,'leak.sql')));assert(!existsSync(join(home,'unsafe-key')));
}finally{rmSync(home,{recursive:true,force:true});}
console.log('PASS optional cohort transport: exact read-only20s query, bound sources/bytes/hash/full membership/original time, private exclusive paths, unchanged evidence/classification/gaps; no append.');
