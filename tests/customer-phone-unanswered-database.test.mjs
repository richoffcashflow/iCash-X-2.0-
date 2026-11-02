import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {pricingBlock} from './helpers/two-times-pricing-fixture.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8'),pg=new PGlite();
const q=(s,a=[])=>pg.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0],id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const ca='CA'+'a'.repeat(32),ac='AC'+'b'.repeat(32),from='+12025550101',to='client:icash_'+'c'.repeat(64),created=new Date(Date.now()-120000).toISOString();
const proof=()=>({policy:'twilio-unanswered-connectivity-v1',accountSid:ac,fromPhone:from,toPhone:to,direction:'outbound-api',duration:'0',price:null,priceUnit:'USD',childrenComplete:true,childrenCount:0,recordingsComplete:true,recordingsCount:0,childInventoryHash:'a'.repeat(64),recordingInventoryHash:'b'.repeat(64),createdAt:created,endedAt:new Date(Date.now()-60000).toISOString(),observedAt:new Date().toISOString()});
const parent=()=>({sid:ca,status:'no-answer',currency:'USD',costMicros:0,receiptHash:'c'.repeat(64),kind:'verified_unanswered_browser_parent',costEvidence:proof()});
const child={currency:'USD',costMicros:0,kind:'verified_empty_child_list_after_parent_end',receiptHash:'a'.repeat(64)};
const audio={status:'absent',currency:'USD',costMicros:0,callSid:ca,providerAccountSid:ac,policy:'customer-phone-recorded-v1',receiptHash:'d'.repeat(64)};
let serial=10;
async function seed(p=parent(),row={}){
 const n=serial++,call=id(n),a=id(1),rate=id(2),op='customer-phone:'+call;
 const cols={id:call,account_id:a,operation_key:op,rate_id:rate,created_at:created,connection_type:'browser',ended_at:new Date().toISOString(),parent_sid:ca,provider_account_sid:ac,business_phone:from,callback_phone:to,parent_receipt:p,child_receipt:child,recording_required:true,recording_state:'absent',recording_receipt:audio,...row};
 const keys=Object.keys(cols);await q('insert into icash_customer_phone_calls('+keys.join(',')+') values('+keys.map((_,i)=>'$'+(i+1)).join(',')+')',Object.values(cols));
 await q("insert into icash_operation_spend values($1,$2,'dispatched',100,2)",[op,a]);return {call,op,settle:()=>v('select icash_settle_customer_phone_call($1)',[call])};
}
try{
 await pg.exec(read('tests/fixtures/customer-phone-unanswered-foundation.sql'));
 const old=read('supabase/migrations/20261008173746_customer_phone_recordings.sql');await pg.exec(old.slice(old.indexOf('create or replace function public.icash_settle_customer_phone_call'),old.lastIndexOf('commit;')));await pg.exec(pricingBlock('settle_customer_phone_call'));
 assert.equal(await v("select md5(pg_get_functiondef('public.icash_settle_customer_phone_call(uuid)'::regprocedure))"),'e3e7cae8c13b1c552c53e974a7a2c685');
 const sql=read('config/customer-phone-unanswered-settlement.sql');assert.equal(sql,read('supabase/migrations/20261102233115_customer_phone_unanswered_settlement.sql'));await pg.exec(sql);
 await q("insert into icash_operation_rates values($1,'customer_phone_call','customer-phone-recorded-2x-v1:fixture','{\"twilio\":100000,\"other\":33000,\"vercel\":2000}')",[id(2)]);
 const a=await seed();assert.equal(await a.settle(),true);assert.equal(await a.settle(),true);assert.equal(await v('select count(*) from settlements where operation=$1',[a.op]),1);const paid=await v('select components from settlements where operation=$1',[a.op]);assert.equal(paid.twilio.amountMicros,0);assert.equal(paid.other.amountMicros,0);assert.equal(paid.vercel.amountMicros,2000,'Original infrastructure allocation retained');assert.equal(await v('select charge from settlements where operation=$1',[a.op]),1);
 for(const change of [{connection_type:'phone'},{connected_at:created},{recipient_answered_at:created},{child_sid:'CA'+'d'.repeat(32)},{recording_sid:'RE'+'d'.repeat(32)},{recording_deleted_at:created},{recording_state:'available'},{recording_required:false},{child_receipt:{...child,costMicros:1}},{child_receipt:{...child,receiptHash:'e'.repeat(64)}},{recording_receipt:{...audio,status:'completed'}},{recording_receipt:{...audio,costMicros:1}}]){const b=await seed(parent(),change);assert.equal(await b.settle(),false,JSON.stringify(change));assert.equal(await v('select state from icash_operation_spend where operation_key=$1',[b.op]),'dispatched');}
 for(const change of [{policy:'other'},{duration:'1'},{duration:0},{duration:undefined},{price:'-0.004'},{price:'bad'},{price:undefined},{priceUnit:'EUR'},{accountSid:'AC'+'e'.repeat(32)},{fromPhone:'+12025550999'},{toPhone:'+12025550999'},{direction:'inbound'},{childrenComplete:false},{childrenCount:1},{recordingsComplete:false},{recordingsCount:1},{childInventoryHash:null},{recordingInventoryHash:null},{createdAt:'infinity'},{createdAt:'bad'},{endedAt:new Date().toISOString()},{observedAt:new Date(Date.now()-180000).toISOString()},{observedAt:'bad'},{observedAt:undefined}]){const p=parent();Object.assign(p.costEvidence,change);const b=await seed(p);assert.equal(await b.settle(),false,JSON.stringify(change));}
 for(const change of [{sid:'CA'+'e'.repeat(32)},{status:'completed'},{status:undefined},{costMicros:1},{currency:'EUR'},{receiptHash:null}]){const b=await seed({...parent(),...change});assert.equal(await b.settle(),false,JSON.stringify(change));}
 console.log('PASS unanswered browser settlement database: current binding, fresh complete provider proofs, late connection/child/audio refusal, preserved original allocations and exactly-once settlement.');
}finally{await pg.close();}
