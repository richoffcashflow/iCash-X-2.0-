import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {supportOutreachEvidence} from '../lib/support-outreach.ts';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8'),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const a=id(1),b=id(2),s=id(3),d=id(4),t=id(5),notice='Free Msg: Receiver 12125550123 unable to receive message - Message Blocking is active';
const pg=await PGlite.create(),q=(s,p=[])=>pg.query(s,p),diag=async()=> (await q('select icash_support_outreach_diagnostics($1) x',[a])).rows[0].x;
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role;
 create table icash_screening_jobs(id uuid,account_id uuid,state text,snapshot jsonb);
 create table icash_owner_contacts(screening_id uuid,account_id uuid,result jsonb);
 create table icash_text_messages(id uuid,account_id uuid,thread_id uuid,direction text,state text,body text,attachments jsonb default '[]',provider_id text,event_id text);
 create table icash_text_threads(id uuid,account_id uuid,deal_id uuid,party text);
 create table icash_deal_files(id uuid,account_id uuid,screening_id uuid);
 create table icash_voice_jobs(account_id uuid,permission_id uuid,operational_contact_id uuid,provider_call_sid text,state text,outcome text,conversation_id text);
 create table icash_voice_contact_targets(id uuid,account_id uuid,party text,screening_id uuid);
 create function icash_prospecting_progress(uuid) returns jsonb language sql as $$select '{"status":"ready","remainingCents":500,"spentCents":100,"pendingCents":25}'::jsonb$$;`);
 await pg.exec(read('tests/fixtures/carrier-notice-support-before.sql'));
 const foundation=read('config/carrier-text-notice-classification.sql');await pg.exec(foundation.slice(foundation.indexOf('create function public.icash_is_carrier_text_notice'),foundation.indexOf('create view public.icash_response_text_attention')));
 await q("insert into icash_screening_jobs values($1,$2,'complete','{}')",[s,a]);await q('insert into icash_deal_files values($1,$2,$3)',[d,a,s]);await q("insert into icash_text_threads values($1,$2,$3,'seller')",[t,a,d]);
 for(const [n,body,direction,state,attachments,account] of [[10,notice,'incoming','received',[],a],[11,notice,'outgoing','delivered',[],a],[12,'Other sent text','outgoing','accepted',[],a],[13,'Yes, I want to sell','incoming','received',[],a],[14,'I got "'+notice+'". Please call.','incoming','received',[],a],[15,notice,'incoming','received',[{url:'https://example.invalid/photo'}],a],[16,notice,'incoming','received',[],b]])await q('insert into icash_text_messages values($1,$2,$3,$4,$5,$6,$7,\'fixture-provider\',null)',[id(n),account,t,direction,state,body,attachments]);
 const before=await diag(),raw=(await q('select * from icash_text_messages order by id')).rows;assert.equal(before.textReplies,4);
 const sourceDef=(await q("select pg_get_functiondef('icash_support_outreach_diagnostics(uuid)'::regprocedure) def")).rows[0].def;
 const patch=read('config/carrier-text-notice-support.sql');assert.equal(patch,read('supabase/migrations/20261109000600_carrier_text_notice_support.sql'));await pg.exec(patch);
 const after=await diag();assert.equal(after.textReplies,3);assert.deepEqual({...after,textReplies:4},before,'Sent/delivered/progress/budget evidence unchanged');assert.deepEqual((await q('select * from icash_text_messages order by id')).rows,raw);
 const evidence=supportOutreachEvidence(after);assert.match(evidence.detail,/2 texts sent, 1 delivered, 3 text replies/);assert.equal(evidence.outreach.progress.pendingCents,25);assert.match(supportOutreachEvidence(before).detail,/4 text replies/);
 assert.equal(sourceDef.match(/'textReplies'/g).length,1);
 console.log('PASS carrier support: real diagnostics to customer support evidence excludes only notice reply, preserves human quotes/attachments, account fences and all traffic/budget/raw evidence.');
}finally{await pg.close();}
