// Account/contact-bound history fixtures only; no provider traffic or live messages.
import assert from 'node:assert/strict';
import test from 'node:test';
import {z} from 'zod';
import {createHash} from 'node:crypto';
import {threadConversationCalls} from '../lib/thread-conversation-calls.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';
const account='11111111-1111-4111-8111-111111111111',screen='22222222-2222-4222-8222-222222222222',recording='33333333-3333-4333-8333-333333333333',deal='44444444-4444-4444-8444-444444444444',conversation='55555555-5555-4555-8555-555555555555',threadId='66666666-6666-4666-8666-666666666666',actor='77777777-7777-4777-8777-777777777777';
const phone='+12025550101',contactKey=createHash('sha256').update(phone).digest('hex'),at='2026-10-21T16:00:00Z';
const thread={id:threadId,dealId:deal,recipient:phone,party:'seller'};
const row={id:recording,account_id:account,screening_id:screen,operation_key:'voice:'+recording,conversation_id:'conv_fixture',contact_key:contactKey,party:'seller',call_sid:'CA'+'a'.repeat(32),created_at:at,state:'available',duration_seconds:42,audio_expires_at:'2027-01-01T00:00:00Z',recording_sid:'RE'+'b'.repeat(32),consent_at:null,entry_policy:'direct_recorded_v1',recording_authorized_at:at,deleted_at:null};
let completed=[],records=[row],linked=[],failedRpc=false,failedRecordings=false;
const db=async(path,method,body)=>{
 if(path==='rpc/icash_thread_calls'){assert.equal(body.p_account,account);assert.equal(body.p_thread,threadId);if(failedRpc)throw Error('fixture');return completed;}
 const q=new URLSearchParams(path.split('?')[1]);assert.equal(q.get('account_id'),'eq.'+account);
 if(path.startsWith('icash_deal_files?')){assert.equal(q.get('id'),'eq.'+deal);return [{id:deal,screening_id:screen}];}
 if(path.startsWith('icash_screening_jobs?'))return [{id:screen}];
 if(path.startsWith('icash_call_recordings?')){assert.equal(q.get('screening_id'),'eq.'+screen);assert.equal(q.get('contact_key'),'eq.'+contactKey);assert.equal(q.get('party'),'eq.seller');assert.equal(q.get('call_sid'),'not.is.null');if(failedRecordings)throw Error('fixture');return records;}
 if(path.startsWith('icash_live_conversations?'))return linked;
 throw Error(path);
};
test('initial call audio appears without a finished transcript and never exposes provider fields',async()=>{
 const result=await threadConversationCalls(db,account,thread,null,null,true);
 assert.equal(result.callsUnavailable,false);assert.equal(result.calls.length,1);assert.equal(result.calls[0].recordingId,recording);assert.equal(result.calls[0].transcriptAvailable,false);assert.equal(result.calls[0].recordingReceipt.status,'available');
 assert(!JSON.stringify(result).includes('contact_key'));assert(!JSON.stringify(result).includes('CA'+ 'a'.repeat(32)));
});
test('one call stays one entry after its transcript arrives, while one failed history source preserves the other',async()=>{
 completed=[{id:conversation,source:'outbound',party:'seller',completedAt:at}];linked=[{id:conversation,account_id:account,screening_id:screen,operation_key:row.operation_key,conversation_id:row.conversation_id}];
 let result=await threadConversationCalls(db,account,thread,null,null,true);assert.equal(result.calls.length,1);assert.equal(result.calls[0].id,conversation);assert.equal(result.calls[0].recordingId,recording);
 failedRecordings=true;result=await threadConversationCalls(db,account,thread,null,null,true);assert.equal(result.calls.length,1);assert.equal(result.callsUnavailable,true);failedRecordings=false;
 failedRpc=true;result=await threadConversationCalls(db,account,thread,null,null,true);assert.equal(result.calls.length,1);assert.equal(result.callsUnavailable,true);failedRpc=false;
 records=[{...row,contact_key:'foreign'}];result=await threadConversationCalls(db,account,thread,null,null,true);assert.equal(result.calls[0].recordingId,undefined);assert.equal(result.callsUnavailable,true);records=[row];
});
test('text history defaults to seller, labels human/AI authors, preserves first message and rejects another deal thread',async()=>{
 let selectedMissing=false,queueCalls=0;
 const first={id:recording,thread_id:threadId,direction:'outgoing',body:'First AI text',state:'delivered',created_at:at,customer_author_id:null,request_key:null};
 const manual={...first,id:conversation,body:'My reply',customer_author_id:actor,request_key:recording};
 const route=await loadService('app/api/work/messages/route.ts',{z,NextResponse:{json:(v,init)=>Response.json(v,init)},workAccount:async()=>({accountId:account,userId:actor}),allowedOrigin:()=>true,threadConversationCalls:async(_db,a,t)=>{assert.equal(a,account);assert.equal(t.id,threadId);return {calls:[],callsUnavailable:false};},db:async(path)=>{
  if(path.startsWith('icash_text_threads?')){assert(path.includes('account_id=eq.'+account)&&path.includes('deal_id=eq.'+deal)&&path.includes('retired_at=is.null'));if(path.includes('&id=eq.'))return [];return [{id:recording,party:'buyer',recipient:'+12025550102',paused:false},...selectedMissing?[]:[{...thread,paused:false}]];}
  if(path.startsWith('icash_text_messages?')){assert(path.includes('thread_id=eq.'+threadId)&&path.includes('account_id=eq.'+account));return path.includes('order=created_at.asc')?[first]:[manual,first];}
  if(path==='rpc/icash_manual_text_reason')return null;
  queueCalls++;throw Error(path);
 }});
 let response=await route.GET(new Request('https://example.invalid/api/work/messages?dealId='+deal));assert.equal(response.status,200);const data=await response.json();assert.equal(data.threadId,threadId);assert.equal(data.messages[0].author,'you');assert.equal(data.messages[1].author,'bot');assert.equal(data.firstMessage.body,first.body);assert(!JSON.stringify(data).includes('customer_author_id'));assert.equal(queueCalls,0,'viewing does not queue or take over');
 selectedMissing=true;response=await route.GET(new Request('https://example.invalid/api/work/messages?dealId='+deal+'&threadId='+threadId));assert.equal(response.status,400);
});
