// Captured synthetic pgcrypto ciphertext only. No database or network access.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {decryptEnvelope,transportCli} from './work-cohort-transport.mjs';
const f=JSON.parse(readFileSync(new URL('../tests/fixtures/work-cohort-transport.json',import.meta.url),'utf8'));
const result=decryptEnvelope(f.baseline,f.envelope,f.key);
assert.deepEqual(result.plaintext,Buffer.from(f.plaintext));assert.equal(result.receipt.observationAppended,false);
assert.equal(JSON.parse(result.plaintext.toString('utf8'))[1].evidence.diagnostic_text,'Café 雪\r\nsecond\nline');
assert.throws(()=>decryptEnvelope(f.baseline,f.envelope,'f'.repeat(64)),/GPG_DECRYPTION_FAILED/);
const tampered=Buffer.from(f.envelope.encrypted_base64,'base64');tampered[tampered.length-8]^=1;
assert.throws(()=>decryptEnvelope(f.baseline,{...f.envelope,encrypted_base64:tampered.toString('base64')},f.key),/GPG_DECRYPTION_FAILED/);
assert.throws(()=>decryptEnvelope(f.baseline,{...f.envelope,raw_bytes:1},f.key),/GPG_DECRYPTION_FAILED/);
const home=mkdtempSync(join(tmpdir(),'cohort-gpg-test-'));
try{
 const b=join(home,'baseline.json'),k=join(home,'key'),q=join(home,'read.sql'),e=join(home,'envelope.json'),rows=join(home,'rows.json');
 for(const [path,value] of [[b,JSON.stringify(f.baseline)],[k,f.key+'\n'],[e,JSON.stringify(f.envelope)]])writeFileSync(path,value,{mode:0o600});
 transportCli(['sql',b,k,q]);
 assert.equal(transportCli(['decode',b,k,q,e,rows]).observationAppended,false);
 assert.deepEqual(readFileSync(rows),Buffer.from(f.plaintext));assert.equal(statSync(rows).mode&0o077,0);
 assert.throws(()=>transportCli(['decode',b,k,q,e,rows]),/EEXIST/);
 const bad=join(home,'bad.json');writeFileSync(e,JSON.stringify({...f.envelope,plaintext_sha256:'0'.repeat(64)}));
 assert.throws(()=>transportCli(['decode',b,k,q,e,bad]),/INTEGRITY_FAILED/);assert(!existsSync(bad));
 writeFileSync(e,JSON.stringify(f.envelope));writeFileSync(q,readFileSync(q).toString()+'\n');
 assert.throws(()=>transportCli(['decode',b,k,q,e,bad]),/QUERY_CHANGED/);assert(!existsSync(bad));
}finally{rmSync(home,{recursive:true,force:true});}
console.log('PASS native GPG: synthetic pgcrypto ZLIB/AES256 exact bytes and CLI output, wrong key/tampering/output bound rejected, private exclusive output only after verification.');
