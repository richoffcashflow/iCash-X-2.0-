import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);const pg=await PGlite.create();
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role;
 create table public.icash_accounts(id uuid primary key,owner_user_id uuid,vip boolean);
 create function public.icash_vip_active(p_account uuid) returns boolean language sql as $$select vip from public.icash_accounts where id=p_account$$;`);
 await pg.exec(readFileSync(new URL('../config/vip-custom-voice.sql',import.meta.url),'utf8'));
 const a='00000000-0000-4000-8000-000000000001',u='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000003';
 await pg.query('insert into icash_accounts values($1,$2,true)',[a,u]);
 const begin=(who=u)=>pg.query("select icash_begin_custom_voice($1,$2,$3,'own-voice-2026-10-07.1') v",[who,a,'a'.repeat(64)]);
 await assert.rejects(begin(other));let result=(await begin()).rows[0].v;assert(result.started);const id=result.voice.id;
 result=(await begin()).rows[0].v;assert.equal(result.started,false);assert.equal(result.voice.id,id);
 await pg.query("update icash_custom_voices set voice_id='voice_fixture',state='ready' where account_id=$1",[a]);
 const selected=async()=>(await pg.query('select icash_vip_call_voice($1) v',[a])).rows[0].v;
 assert.equal(await selected(),'voice_fixture');await assert.rejects(pg.query('select icash_set_custom_voice_enabled($1,$2,false)',[other,a]));
 await pg.query('select icash_set_custom_voice_enabled($1,$2,false)',[u,a]);assert.equal(await selected(),null);
 await pg.query('select icash_set_custom_voice_enabled($1,$2,true)',[u,a]);assert.equal(await selected(),'voice_fixture');
 await pg.query('update icash_accounts set vip=false where id=$1',[a]);assert.equal(await selected(),null);await assert.rejects(pg.query('select icash_set_custom_voice_enabled($1,$2,true)',[u,a]));await assert.rejects(begin());
 const roles=(await pg.query("select has_function_privilege('anon','icash_vip_call_voice(uuid)','EXECUTE') a,has_function_privilege('authenticated','icash_begin_custom_voice(uuid,uuid,text,text)','EXECUTE') b,has_table_privilege('anon','icash_custom_voices','SELECT') c")).rows[0];assert.deepEqual(roles,{a:false,b:false,c:false});
 console.log('PASS voice SQL: ownership, retry serialization, toggle, VIP gating and service-only permissions');
}finally{await pg.close();}
