// Real SQL in an isolated Postgres engine. No production or provider calls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {z} from 'zod';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {isConfirmedVoicemail} from '../lib/call-display-evidence.ts';
const pg=await PGlite.create(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const account=id(1),other=id(2),user=id(3),otherUser=id(4);
const sql=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const rows=async(q,p=[]) =>(await pg.query(q,p)).rows;
const scalar=async(q,p=[])=>Object.values((await rows(q,p))[0])[0];
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table icash_accounts(id uuid primary key,owner_user_id uuid);
 create table icash_screening_jobs(id uuid primary key,account_id uuid,state text,snapshot jsonb default '{}',result jsonb default '{}',completed_at timestamptz default now(),created_at timestamptz default now());
 create table icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid,terms jsonb default '{}');
 create table icash_text_threads(id uuid primary key,account_id uuid,deal_id uuid,party text,retired_at timestamptz);
 create table icash_text_messages(id uuid primary key,account_id uuid,thread_id uuid,direction text,state text,body text,created_at timestamptz);
 create table icash_workspace_revisions(account_id uuid primary key,revision bigint default 1,changed_at timestamptz default now());
 create table icash_meta_leads(screening_id uuid,account_id uuid,response_at timestamptz);
 create table icash_opportunity_outcomes(screening_id uuid,account_id uuid,responded boolean,interested boolean,opted_out boolean,purchase_signed boolean,response_at timestamptz);
 create function icash_property_contact_priority(uuid,uuid) returns numeric language sql as $$select 0::numeric$$;
 insert into icash_accounts values('${account}','${user}'),('${other}','${otherUser}');`);
 await pg.exec(sql('tests/fixtures/seller-reply-workspace-before.sql'));
 assert.equal(sql('config/seller-reply-visibility.sql'),sql('supabase/migrations/20261027193527_seller_reply_visibility.sql'));
 await pg.exec(sql('config/seller-reply-visibility.sql'));
 const beforeAcl=await rows("select proacl,prosecdef,provolatile,proconfig from pg_proc where oid='icash_latest_seller_text_thread(uuid,uuid)'::regprocedure");
 assert.equal(sql('config/seller-default-conversation.sql'),sql('supabase/migrations/20261107212550_seller_default_conversation.sql'));
 await pg.exec(sql('config/seller-default-conversation.sql'));
 assert.deepEqual(await rows("select proacl,prosecdef,provolatile,proconfig from pg_proc where oid='icash_latest_seller_text_thread(uuid,uuid)'::regprocedure"),beforeAcl);

 for(let n=10;n<22;n++){
  const a=n===21?other:account,state=n===19?'archived':n===20?'awaiting_address':'complete';
  await pg.query(`insert into icash_screening_jobs(id,account_id,state,result) values($1,$2,$3,$4)`,[id(n),a,state,{property:{propertyId:n===18?'practice_demo':'prop_'+n,address:n+' Main Street'}}]);
  await pg.query(`insert into icash_deal_files(id,account_id,screening_id) values($1,$2,$3)`,[id(n+100),a,id(n)]);
  await pg.query(`insert into icash_text_threads(id,account_id,deal_id,party) values($1,$2,$3,'seller')`,[id(n+200),a,id(n+100)]);
  await pg.query(`insert into icash_text_messages values($1,$2,$3,'incoming','received',$4,$5)`,[id(n+300),a,id(n+200),'Reply '+n,`2026-10-27T12:${n}:00Z`]);
 }
 // The latest reply is on the lower UUID thread, not the first ID-sorted contact.
 await pg.query(`insert into icash_text_threads values($1,$2,$3,'seller',null),($4,$2,$3,'buyer',null),($5,$2,$3,'seller',now())`,[id(5),account,id(110),id(6),id(7)]);
 for(const [n,t,dir] of [[400,5,'incoming'],[401,6,'incoming'],[402,7,'incoming'],[403,210,'outgoing']])await pg.query(`insert into icash_text_messages values($1,$2,$3,$4,'received','Latest reply','2026-10-27T13:00:00Z')`,[id(n),account,id(t),dir]);
 assert.equal(await scalar('select icash_latest_seller_text_thread($1,$2)',[account,id(110)]),id(5));
 assert.equal(await scalar('select icash_latest_seller_text_thread($1,$2)',[other,id(110)]),null);
 const counts=()=>scalar('select icash_workspace_text_reply_counts($1)',[account]);
 assert.equal((await scalar('select icash_workspace_response_counts($1)',[account])).responded,9);
 assert.deepEqual(await counts(),{properties:9,unreadProperties:9,unreadMessages:10});
 const page=await rows("select * from icash_workspace_text_reply_ids($1,'',0,7,true)",[account]);
 assert.equal(page.length,7);assert.equal(page[0].screening_id,id(10));assert.equal(page[1].screening_id,id(20));
 assert(!page.some(p=>[id(18),id(19),id(21)].includes(p.screening_id)));
 const summary=await rows('select * from icash_workspace_seller_texts($1,$2)',[account,[id(10)]]);
 assert.equal(Number(summary[0].unread_count),2);assert.equal(summary[0].thread_id,id(5));
 // Replies qualify immediately without waiting for an outcome refresh or financial eligibility.
 assert.equal((await rows("select * from icash_workspace_ready_opportunities($1,'',0,7)",[account]))[0].id,id(10));
 assert((await rows("select * from icash_workspace_opportunities($1,'',0,25,true)",[account])).some(p=>p.id===id(10)));
 const mark=(a,u,t,ids)=>scalar('select icash_mark_text_messages_read($1,$2,$3,$4)',[a,u,t,ids]);
 for(const args of [[account,otherUser,id(5),[id(400)]],[other,otherUser,id(5),[id(400)]],[account,user,id(210),[id(400)]],[account,user,id(210),[id(403)]],[account,user,id(7),[id(402)]],[account,user,id(5),[]]])await assert.rejects(mark(...args),/Invalid message read/);
 await mark(account,user,id(5),[id(400)]);assert.equal((await counts()).unreadMessages,9);
 assert.equal(await scalar('select icash_latest_seller_text_thread($1,$2)',[account,id(110)]),id(210),'An unread reply on another contact stays discoverable');
 assert.equal((await rows('select * from icash_workspace_seller_texts($1,$2)',[account,[id(10)]]))[0].thread_id,id(210));
 const revision=await scalar('select revision from icash_workspace_revisions where account_id=$1',[account]);
 await mark(account,user,id(5),[id(400)]);assert.equal(await scalar('select revision from icash_workspace_revisions where account_id=$1',[account]),revision,'Repeated reads do not wake every subscriber');
 await pg.query(`insert into icash_text_messages values($1,$2,$3,'incoming','received','A new reply','2026-10-27T13:00:00Z')`,[id(410),account,id(5)]);
 await mark(account,user,id(210),[id(310)]);assert.equal((await counts()).unreadMessages,9,'A later arrival, including the same timestamp, remains unread');
 await mark(account,user,id(5),[id(410)]);assert.equal((await counts()).unreadProperties,8);
 const unread=await rows("select * from icash_workspace_text_reply_ids($1,'',0,25,true)",[account]);assert(!unread.some(p=>p.screening_id===id(10)));
 assert.equal((await rows("select * from icash_workspace_text_reply_ids($1,'10 Main',0,7,false)",[account])).length,1);
 assert.equal(await scalar("select has_table_privilege('authenticated','icash_text_message_reads','select')"),false);
 assert.equal(await scalar("select has_function_privilege('anon','icash_mark_text_messages_read(uuid,uuid,uuid,uuid[])','execute')"),false);
 assert.equal(await scalar("select relrowsecurity from pg_class where oid='icash_text_message_reads'::regclass"),true);

 // No inbound replies: prefer the actual recorded conversation, not random UUID.
 const outboundDeal=id(900),outboundThread=id(50),empty=id(950),latest=id(45);
 await pg.query(`insert into icash_text_threads values($1,$2,$3,'seller',null),($4,$2,$3,'seller',null),($5,$2,$3,'seller',null)`,[outboundThread,account,outboundDeal,empty,latest]);
 assert.equal(await scalar('select icash_latest_seller_text_thread($1,$2)',[account,outboundDeal]),empty,'Empty-only accounts keep deterministic selection');
 const states=['ready','accepted','delivered','failed','needs_review'];
 for(const state of states){
  await pg.query(`insert into icash_text_messages values($1,$2,$3,'outgoing',$4,'Recorded message','2026-11-07T12:00:00Z') on conflict(id) do update set state=excluded.state`,[id(960),account,outboundThread,state]);
  assert.equal(await scalar('select icash_latest_seller_text_thread($1,$2)',[account,outboundDeal]),outboundThread,'Display recorded '+state+' without claiming delivery');
 }
 await pg.query(`insert into icash_text_messages values($1,$2,$3,'outgoing','accepted','Newest recorded message','2026-11-07T12:00:00Z')`,[id(961),account,latest]);
 assert.equal(await scalar('select icash_latest_seller_text_thread($1,$2)',[account,outboundDeal]),latest,'Message ID breaks same-time ties');
 // Foreign-account message on an owned thread cannot determine the default.
 await pg.query(`insert into icash_text_messages values($1,$2,$3,'outgoing','delivered','Foreign message','2026-11-08T12:00:00Z')`,[id(962),other,empty]);
 assert.equal(await scalar('select icash_latest_seller_text_thread($1,$2)',[account,outboundDeal]),latest);
 await pg.query(`insert into icash_text_messages values($1,$2,$3,'outgoing','accepted','Newer timestamp with lower ID','2026-11-07T13:00:00Z')`,[id(940),account,outboundThread]);
 assert.equal(await scalar('select icash_latest_seller_text_thread($1,$2)',[account,outboundDeal]),outboundThread,'Timestamp wins before random message ID');
 await pg.query(`insert into icash_text_messages values($1,$2,$3,'incoming','received','Old unread response','2026-10-01T12:00:00Z')`,[id(963),account,outboundThread]);
 assert.equal(await scalar('select icash_latest_seller_text_thread($1,$2)',[account,outboundDeal]),outboundThread,'Unread reply still outranks newer outbound activity');
 await mark(account,user,outboundThread,[id(963)]);
 assert.equal(await scalar('select icash_latest_seller_text_thread($1,$2)',[account,outboundDeal]),outboundThread,'A recorded received reply retains original reply priority');
 await pg.query('update icash_text_threads set retired_at=now() where id=$1',[outboundThread]);
 assert.equal(await scalar('select icash_latest_seller_text_thread($1,$2)',[account,outboundDeal]),latest,'Retired conversations stay excluded');
 await pg.query("update icash_text_threads set party='buyer' where id=$1",[latest]);
 assert.equal(await scalar('select icash_latest_seller_text_thread($1,$2)',[account,outboundDeal]),empty,'Buyer activity cannot redirect seller conversation');
 assert.equal(await scalar('select icash_latest_seller_text_thread($1,$2)',[other,outboundDeal]),null);
 const after=(await rows("select md5(pg_get_functiondef('icash_latest_seller_text_thread(uuid,uuid)'::regprocedure)) hash"))[0].hash;
 assert.equal(after,'3d04b594768e59e8840cbbba29279f7a');
 console.log('Default conversation replacement hash:',after);
 let sameOrigin=true,signedIn=true,calls=[];
 const route=await loadService('app/api/work/messages/read/route.ts',{z,NextResponse:{json:(v,o)=>Response.json(v,o)},allowedOrigin:()=>sameOrigin,workAccount:async()=>{if(!signedIn)throw Error();return {accountId:account,userId:user};},db:async(path,method,body)=>{calls.push({path,method,body});return mark(body.p_account,body.p_user,body.p_thread,body.p_messages);}});
 const post=body=>route.POST(new Request('https://example.invalid/api/work/messages/read',{method:'POST',body:JSON.stringify(body)}));
 const valid={threadId:id(5),messageIds:[id(400)]};
 assert.equal((await post(valid)).status,200);assert.equal(calls[0].body.p_user,user);
 for(const body of [{...valid,accountId:other},{...valid,messageIds:[]},{...valid,messageIds:Array(21).fill(id(400))},{...valid,threadId:id(210)}])assert.equal((await post(body)).status,400);
 sameOrigin=false;assert.equal((await post(valid)).status,403);sameOrigin=true;signedIn=false;assert.equal((await post(valid)).status,400);
 const vm=message=>({role:'user',message});
 assert.equal(isConfirmedVoicemail([vm('Your call has been forwarded. Please leave a message after the tone.')]),true);
 assert.equal(isConfirmedVoicemail([vm('I listened to your voicemail and I want to sell.')]),false);
 assert.equal(isConfirmedVoicemail([vm('Please leave a message after the tone.'),vm('Hello, yes I can talk now.')]),false);
 assert.equal(isConfirmedVoicemail([vm('I want to sell. Please leave a message if you call tomorrow.')]),false);
 assert.equal(isConfirmedVoicemail([vm('Your voicemail said please leave a message after the beep.')]),false);
 assert.equal(isConfirmedVoicemail([]),false);assert.equal(isConfirmedVoicemail(null),false);
 await assert.rejects(pg.exec(sql('config/seller-default-conversation.sql')),/prerequisite changed/);await pg.exec('rollback');
 assert.equal((await rows("select md5(pg_get_functiondef('icash_latest_seller_text_thread(uuid,uuid)'::regprocedure)) hash"))[0].hash,after,'Unexpected/repeated predecessor cannot rewrite the selector');
 console.log('Seller reply SQL and routes: tenant ownership, unread-first pagination, saved replies, exact-message read receipts, late arrivals, idempotency, read-only permissions and conservative voicemail display passed.');
}finally{await pg.close();}
