import assert from 'node:assert/strict';
import {z} from 'zod';
import {smsLength} from '../lib/sms-length.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,account=id(1),actor=id(2),question=id(3),thread=id(4),screening=id(5),source=id(6),message=id(7);
let auth=true,origin=true,changed=false,blocked=false,uncertain=false,saved=false;const writes=[],sends=[];
const route=await loadService('app/api/work/assistant/actions/route.ts',{z,smsLength,NextResponse:{json:Response.json},allowedOrigin:()=>origin,workAccount:async options=>{assert.equal(options.requireVip,true);if(!auth)throw Error('SIGN_IN_REQUIRED');return {accountId:account,userId:actor};},db:async(path,method='GET',body)=>{
 if(method==='POST'){
  assert.equal(body.p_account,account);
  if(path==='rpc/icash_manual_text_reason')return null;
  assert.equal(path,'rpc/icash_queue_assistant_text');assert.equal(body.p_actor,actor);writes.push(body);if(blocked)return {error:'The conversation changed'};saved=true;return {id:message,threadId:thread};
 }
 if(path.startsWith('icash_assistant_action_settings?'))return [{enabled:true}];
 assert(path.includes('account_id=eq.'+account),'All records are account scoped');
 if(path.startsWith('icash_workspace_questions?'))return [{completed_at:new Date().toISOString(),answer:{actions:[{kind:'property',screeningId:screening,threadId:thread,draft:{threadId:thread,body:'Please share photos.',latestMessageId:source}}]}}];
 if(path.startsWith('icash_text_threads?'))return [{id:thread,deal_id:id(8),party:'seller'}];
 if(path.startsWith('icash_deal_files?')){assert(path.includes('screening_id=eq.'+screening));return [{terms:{address:'123 Example St'}}];}
 if(path.startsWith('icash_assistant_text_actions?'))return saved?[{message_id:message}]:[];
 if(path.includes('id=eq.'+message))return [{id:message,state:'needs_review',body:'Please share photos.',request_key:id(10)}];
 if(path.startsWith('icash_text_messages?'))return [{id:changed?id(9):source,body:'Can you text me?',direction:'incoming',state:'received'}];
 throw Error(path);
},dispatchTextMessage:async(a,m,manual)=>{assert.equal(a,account);assert.equal(m,message);assert.equal(manual,true);sends.push(m);if(uncertain)throw Error('Original transport outcome unavailable');return {status:'message_accepted'};},customerTextStatus:async()=>({status:uncertain?'message_delivery_needs_review':'message_accepted',state:uncertain?'needs_review':'accepted'})});
const input={questionId:question,actionIndex:0,requestKey:id(10),message:'Please share photos.'};const post=(body=input)=>new Request('https://fixture.invalid/api/work/assistant/actions',{method:'POST',body:JSON.stringify(body)});const get=()=>new Request('https://fixture.invalid/api/work/assistant/actions?questionId='+question+'&actionIndex=0');
auth=false;assert.equal((await route.POST(post())).status,409);assert.equal(writes.length,0);auth=true;origin=false;assert.equal((await route.POST(post())).status,403);origin=true;
assert.equal((await route.POST(post({...input,accountId:id(99)}))).status,409);assert.equal(writes.length,0);
const preview=await route.GET(get());assert.equal(preview.headers.get('Cache-Control'),'private, no-store');assert.equal((await preview.json()).reason,null);assert.equal(sends.length,0,'Preview never sends');
changed=true;assert.match((await (await route.GET(get())).json()).reason,/conversation changed/);blocked=true;assert.equal((await route.POST(post())).status,409);assert.equal(sends.length,0);
blocked=false;uncertain=true;assert.equal((await (await route.POST(post())).json()).status,'message_delivery_needs_review');assert.equal(sends.length,1);
assert.equal((await (await route.GET(get())).json()).receipt.state,'needs_review','Saved action recovers a lost response without another write');assert.equal(sends.length,1);
console.log('PASS Ask AI route: VIP/account/origin checks, strict inputs, read-only preview, changed source, original uncertain receipt and manual final dispatch.');
