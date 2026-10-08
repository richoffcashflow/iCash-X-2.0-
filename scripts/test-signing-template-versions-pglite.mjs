import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href),pg=await PGlite.create();
try{
 await pg.exec(`create table icash_signing_templates(id text primary key,state_code text,kind text,signer_count int,test_mode boolean,template_scope text,enabled boolean,field_map jsonb);
 create unique index icash_standard_template_kind_signers_mode on icash_signing_templates(kind,signer_count,test_mode) where template_scope='standard';
 create unique index icash_state_template_state_kind_signers_mode on icash_signing_templates(state_code,kind,signer_count,test_mode) where template_scope='state';
 create table envelopes(template_id text references icash_signing_templates(id));
 insert into icash_signing_templates values('original','TX','purchase',1,false,'standard',true,'{"earnestCents":"earnestCents"}');
 insert into envelopes values('original');`);
 await pg.exec(readFileSync(new URL('../config/signing-template-versions.sql',import.meta.url),'utf8'));
 await assert.rejects(pg.exec(`insert into icash_signing_templates values('duplicate','TX','purchase',1,false,'standard',true,'{}')`),/duplicate key/);
 await pg.exec(`begin;update icash_signing_templates set enabled=false where id='original';insert into icash_signing_templates values('current','TX','purchase',1,false,'standard',true,'{}');commit;`);
 assert.equal((await pg.query(`select t.field_map from envelopes e join icash_signing_templates t on t.id=e.template_id`)).rows[0].field_map.earnestCents,'earnestCents');
 assert.equal((await pg.query(`select id from icash_signing_templates where enabled and kind='purchase' and template_scope='standard'`)).rows[0].id,'current');
 await assert.rejects(pg.exec(`update icash_signing_templates set enabled=true where id='original'`),/duplicate key/);
 await pg.exec(`insert into icash_signing_templates values('state','TX','purchase',1,false,'state',true,'{}')`);
 await assert.rejects(pg.exec(`insert into icash_signing_templates values('state_duplicate','TX','purchase',1,false,'state',true,'{}')`),/duplicate key/);
 console.log('PASS template version switch: one enabled template per scope, original envelope mapping preserved, duplicate activation rejected.');
}finally{await pg.close();}
