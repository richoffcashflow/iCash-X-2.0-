import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
try{
 await db.exec(`
  create role anon;create role authenticated;create role service_role;
  create table public.icash_webinar_text_senders(phone text primary key,enabled boolean,preferred boolean);
  create table public.icash_webinar_text_assignments(recipient text primary key,sender text);
  create table public.icash_text_threads(sender text,recipient text,retired_at timestamptz);
  insert into public.icash_webinar_text_senders values('+14243948384',true,false),('+17208134296',true,true),('+14244377030',false,false);
 `);
 await db.exec(readFileSync(new URL('../config/balanced-customer-text-routing.sql',import.meta.url),'utf8'));
 const sender=async phone=>(await db.query('select public.icash_webinar_campaign_sender($1) as sender',[phone])).rows[0].sender;
 for(let i=0;i<40;i++)await sender('+1212555'+String(1000+i));
 assert.deepEqual((await db.query('select sender,count(*)::int as count from public.icash_webinar_text_assignments group by sender order by sender')).rows,[{sender:'+14243948384',count:20},{sender:'+17208134296',count:20}]);
 const pinned=await sender('+12125551000');
 await db.exec('update public.icash_webinar_text_senders set preferred=not preferred');
 assert.equal(await sender('+12125551000'),pinned);
 await db.query('update public.icash_webinar_text_senders set enabled=false where phone=$1',[pinned]);
 assert.equal(await sender('+12125551000'),null,'Disabled established sender never rotates');
 assert.equal((await db.query('select sender from public.icash_webinar_text_assignments where recipient=$1',['+12125551000'])).rows[0].sender,pinned);
 await db.exec('update public.icash_webinar_text_senders set enabled=true where phone<>\'+14244377030\'');
 await db.query('insert into public.icash_text_threads values($1,$2,null)',[pinned,'+12125551000']);
 assert.equal(await sender('+12125551000'),null,'Existing role conflict holds');
 await db.exec("insert into public.icash_text_threads values('+14243948384','+12125559999',null)");
 assert.equal(await sender('+12125559999'),'+17208134296','Fresh recipient avoids a property conversation identity');
 assert.equal(await sender('invalid'),null);assert.equal(await sender(null),null);
 assert.equal((await db.query("select count(*)::int as count from public.icash_webinar_text_assignments where sender='+14244377030'")).rows[0].count,0);
 console.log('PASS customer texts: balanced active numbers, sticky assignments, disabled/conflicting routes held, no reminder activation');
}finally{await db.close();}
