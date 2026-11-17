import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {setup as memorySetup,fixture as memoryFixture} from './seller-memory-receipt-fixture.mjs';
import {sellerCallSource} from '../../lib/seller-call-source.ts';
export const migration=readFileSync(new URL('../../config/seller-call-source-completeness.sql',import.meta.url),'utf8');
export async function setup(pg){
 await memorySetup(pg);
 await pg.exec(readFileSync(new URL('../../config/seller-memory-receipt-time.sql',import.meta.url),'utf8'));
 await pg.exec(`alter table public.icash_live_conversations add agent_id text;
 alter table public.icash_call_recordings add screening_id uuid,add contact_key text,add party text,add to_phone text,add conversation_id text,add agent_id text;
 alter table icash_recorded_reception_private.sessions add agent_id text,add contact_key text;
 create table icash_seller_agreement_private.inbound_bindings(session_id uuid primary key,account_id uuid,deal_id uuid,thread_id uuid);
 -- Source fixture only: the existing financial/result saver has independent
 -- native coverage. This sentinel exposes transaction rollback, not payment authority.
 create function public.icash_save_live_result(p_call uuid,p_result jsonb) returns void language plpgsql as $$begin
 update public.icash_live_conversations set result=p_result,state='complete',completed_at=clock_timestamp() where id=p_call;
 end $$;`);
}
export async function fixture(pg){
 const f=await memoryFixture(pg);const {query}=f;
 async function activate(){await query("update icash_seller_call_source_private.policy set enabled=true,activated_at=clock_timestamp(),release_sha=repeat('a',40)");}
 async function outbound(transcript,{state='complete',result={transcript},completedAt=null}={}){
  const id=randomUUID(),conversation='conv_'+id.replaceAll('-',''),agent='agent_fixture',op='voice:'+id;
  await query("insert into public.icash_live_conversations(id,account_id,screening_id,contact_key,party,state,operation_key,completed_at,result,conversation_id,agent_id) values($1,$2,$3,encode(sha256(convert_to($4,'UTF8')),'hex'),'seller',$5,$6,case when $5='complete' then coalesce($7::timestamptz,clock_timestamp()) end,$8,$9,$10)",[id,f.account,f.screen,f.phone,state,op,completedAt,result,conversation,agent]);
  await query("insert into public.icash_call_recordings(account_id,operation_key,provider_started_at,screening_id,contact_key,party,to_phone,conversation_id,agent_id) values($1,$2,clock_timestamp()-interval '60 seconds',$3,encode(sha256(convert_to($4,'UTF8')),'hex'),'seller',$4,$5,$6)",[f.account,op,f.screen,f.phone,conversation,agent]);
  const raw={conversation_id:conversation,agent_id:agent,status:'done',metadata:{start_time_unix_secs:Math.floor(Date.now()/1000)-60},transcript};
  return {id,raw,evidence:sellerCallSource(raw),capture:()=>f.rpc('icash_capture_seller_call_source',{p_kind:'outbound',p_source:id,p_evidence:sellerCallSource(raw)})};
 }
 async function inbound(transcript){
  const id=randomUUID(),conversation='conv_'+id.replaceAll('-','');
  await query("insert into icash_recorded_reception_private.sessions(id,account_id,provider_started_at,conversation_id,from_phone,call_ended_at,agent_id,contact_key) values($1,$2,clock_timestamp()-interval '60 seconds',$3,$4,clock_timestamp(),'agent_fixture',encode(sha256(convert_to($4,'UTF8')),'hex'))",[id,f.account,conversation,f.phone]);
  await query('insert into icash_seller_agreement_private.inbound_bindings values($1,$2,$3,$4)',[id,f.account,f.deal,f.thread]);
  const raw={conversation_id:conversation,agent_id:'agent_fixture',status:'done',metadata:{start_time_unix_secs:Math.floor(Date.now()/1000)-60},transcript};
  return {id,raw,capture:()=>f.rpc('icash_capture_seller_call_source',{p_kind:'inbound',p_source:id,p_evidence:sellerCallSource(raw)})};
 }
 return {...f,activate,outbound,inbound};
}
