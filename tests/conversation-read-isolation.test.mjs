import assert from 'node:assert/strict';
import {z} from 'zod';
import {loadService} from './helpers/simulated-journey-services.mjs';

const accountId='11111111-1111-4111-8111-111111111111',dealId='22222222-2222-4222-8222-222222222222',threadId='33333333-3333-4333-8333-333333333333';
const thread={id:threadId,recipient:'+12025550101',party:'seller',paused:true};
const message={id:'44444444-4444-4444-8444-444444444444',thread_id:threadId,direction:'incoming',body:'Yes, I own it. What is your offer?',state:'received',created_at:'2026-11-09T12:00:00Z',customer_author_id:null,request_key:null};
const NextResponse={json:(body,options)=>Response.json(body,options)},workAccount=async()=>({accountId,userId:accountId});
let owned=true,reason=null,admissionReads=0;
const db=async(path,method,args)=>{
 if(path==='rpc/icash_manual_text_reason'){admissionReads++;assert.deepEqual(args,{p_account:accountId,p_thread:threadId});if(reason instanceof Error)throw reason;return reason;}
 if(path==='rpc/icash_latest_seller_text_thread')return threadId;
 if(path==='rpc/icash_text_thread_reply_summaries')return [{thread_id:threadId,preview:message.body,unread_count:1,received_at:message.created_at}];
 if(path==='rpc/icash_manual_contacts')throw Error('Contact admission timed out');
 assert(path.includes(`account_id=eq.${accountId}`),'Every history and availability read is account bound');
 if(path.startsWith('icash_text_threads?'))return owned?[thread]:[];
 if(path.startsWith('icash_deal_files?'))return [{id:dealId}];
 if(path.startsWith('icash_text_messages?')){assert(path.includes(`thread_id=eq.${threadId}`));return [message];}
 throw Error('Unexpected read '+path);
};
const history=await loadService('app/api/work/messages/route.ts',{NextResponse,z,workAccount,db,allowedOrigin:()=>true,dispatchTextMessage:()=>assert.fail('Reading must not send'),customerTextStatus:()=>assert.fail('Reading must not reconcile a new send'),threadConversationCalls:()=>assert.fail('Calls were not requested')});
const availability=await loadService('app/api/work/messages/availability/route.ts',{NextResponse,z,workAccount,db});
const contacts=await loadService('app/api/work/text-contact/route.ts',{NextResponse,z,workAccount,db,allowedOrigin:()=>true,dealTermsSchema:z.object({})});
const historyRequest=new Request(`https://fixture.invalid/api/work/messages?dealId=${dealId}&threadId=${threadId}`),availabilityRequest=new Request(`https://fixture.invalid/api/work/messages/availability?threadId=${threadId}`);
for(const blocked of [null,'This contact asked not to be texted.',new Error('Admission timeout')]){
 reason=blocked;
 const response=await history.GET(historyRequest),body=await response.json();
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(body.messages[0].body,message.body);assert.equal(body.messages[0].author,'contact');assert.equal(body.availabilityRequired,true);assert.equal(body.threads[0].manualReply,false);assert.equal(admissionReads,0,'History never waits for sending permission');
}
const contactResponse=await contacts.GET(new Request(`https://fixture.invalid/api/work/text-contact?screeningId=${dealId}`));
assert.equal(contactResponse.status,200);assert.deepEqual(await contactResponse.json(),{contacts:[],contactsUnavailable:true,dealId,threadId});
reason=null;assert.deepEqual(await (await availability.GET(availabilityRequest)).json(),{threadId,sendReason:null,manualReply:true});
reason='This contact asked not to be texted.';assert.equal((await (await availability.GET(availabilityRequest)).json()).sendReason,reason);
for(const unknown of [new Error('Timeout'),undefined,{},false]){reason=unknown;assert.equal((await availability.GET(availabilityRequest)).status,503,'Unknown availability never grants sending');}
owned=false;const before=admissionReads;assert.equal((await availability.GET(availabilityRequest)).status,404);assert.equal(admissionReads,before,'Other accounts cannot probe thread admission');assert.equal((await history.GET(historyRequest)).status,400,'Other accounts cannot read a selected conversation');
console.log('PASS conversation read isolation: replies survive blocked/failed admission and contact reads; availability fails closed and remains account bound.');
