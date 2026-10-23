import assert from 'node:assert/strict';
import {reconcilePendingCustomerPhoneCalls} from '../lib/customer-phone-maintenance.ts';
const now=Date.parse('2026-10-23T18:00:00Z'),rows=Array.from({length:5},(_,i)=>({id:String(i),account_id:'fixture',reconciliation_checked_at:null,settled_at:null}));
const visited=[],patches=[];
const db=async(path,method,body)=>{
 const q=new URLSearchParams(path.split('?')[1]);
 if(method==='PATCH'){
  const row=rows.find(r=>'eq.'+r.id===q.get('id'));
  assert.equal(q.get('account_id'),'eq.fixture');assert.equal(q.get('settled_at'),'is.null');
  assert.equal(q.get('reconciliation_checked_at'),row.reconciliation_checked_at?'eq.'+row.reconciliation_checked_at:'is.null');
  patches.push({...body});Object.assign(row,body);return [{...row}];
 }
 assert.equal(q.get('limit'),'3');assert.equal(q.get('order'),'reconciliation_checked_at.asc.nullsfirst,id.asc');
 assert.equal(q.get('and'),'(or(reconciliation_checked_at.is.null,reconciliation_checked_at.lte.2026-10-23T17:55:00.000Z))');
 return rows.filter(r=>!r.settled_at&&!r.reconciliation_checked_at).slice(0,3).map(r=>({...r}));
};
const reconcile=async row=>{visited.push(row.id);assert(row.reconciliation_checked_at,'Persist claim before a carrier failure');if(row.id==='0')throw Error('Provider unavailable');if(row.id==='1')return row;row.settled_at=new Date(now).toISOString();return row;};
assert.deepEqual(await reconcilePendingCustomerPhoneCalls(db,reconcile,now),{checked:3,settled:1,held:1,errors:1});
assert.deepEqual(await reconcilePendingCustomerPhoneCalls(db,reconcile,now),{checked:2,settled:2,held:0,errors:0});
assert.deepEqual(visited,['0','1','2','3','4'],'An unavailable provider or unknown charge cannot starve later calls');
assert(patches.every(p=>Object.keys(p).join(',')==='reconciliation_checked_at'),'Maintenance claims cannot invent costs or settle holds');
let reads=0;
assert.deepEqual(await reconcilePendingCustomerPhoneCalls(async(_path,method)=>method==='PATCH'?[]:[rows[0]],async()=>{reads++;throw Error('Already claimed');},now),{checked:1,settled:0,held:0,errors:0});
assert.equal(reads,0,'A compare-and-set loser cannot perform provider work');
console.log('Customer phone maintenance: durable fair rotation, provider failures, unknown prices, concurrent claim and unchanged holds passed.');
