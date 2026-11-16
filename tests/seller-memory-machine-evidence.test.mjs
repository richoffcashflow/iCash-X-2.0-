import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {callContactEvidence} from '../lib/call-contact-evidence.ts';
const pg=await PGlite.create(),read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
await pg.exec('create role anon;create role authenticated;create role service_role;');
await pg.exec(read('../config/seller-response-policy.sql')+read('../config/seller-optout-base-verbs.sql'));
await pg.exec(read('./fixtures/seller-memory-machine-original.sql'));
await pg.exec(read('../config/seller-memory-machine-evidence.sql'));
for(const [words,human] of [
 [['Nothing has been recorded.'],false],
 [['Nothing has been recorded.','Yes, I own the property.'],true],
 [['Nothing has been recorded.','Stop calling me.'],true],
 [['Nothing has been recorded. I am the owner and I am speaking now.'],true],
 [['Nothing has been recorded in the county yet.'],true],
]){
 const transcript=words.map(message=>({role:'user',message}));
 assert.equal(callContactEvidence(transcript)==='human_response',human);
 assert.equal((await pg.query('select public.icash_call_has_seller_response($1) value',[{transcript}])).rows[0].value,human);
}
await assert.rejects(pg.exec('begin;'+read('../config/seller-memory-machine-evidence.sql')),/predecessor changed/);await pg.exec('rollback');
await pg.close();console.log('PASS machine fragment parity, later live speech, opt-out and exact predecessor protection; no providers.');
