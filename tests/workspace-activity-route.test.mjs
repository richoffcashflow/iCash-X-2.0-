import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const account=uuid(999),otherAccount=uuid(998);
const property=n=>({id:uuid(n),state:'complete',completed_at:'2026-09-30T10:00:00Z',result:{property:{propertyId:`prop_${n}`,address:`${n} Main Street`},financialCheck:{status:'eligible',reason:'Fixture'},preliminarySellerCeilingCents:100000}});
const properties=Array.from({length:20},(_,i)=>property(i+1));
const queue=Array.from({length:14},(_,i)=>({id:uuid(100+i),screening_id:uuid(10+i),deal_id:uuid(200+i),state:'open',kind:'human',party:'seller'}));
let paths=[],authorized=true;
const paginate=(rows,q)=>rows.slice(Number(q.get('offset')??0),Number(q.get('offset')??0)+Number(q.get('limit')??rows.length));
const mocks={z,NextResponse:{json:(body,options={})=>({body,status:options.status??200,headers:options.headers})},workAccount:async()=>{if(!authorized)throw Error();return {accountId:account};},db:async(path,method,body)=>{
 paths.push({path,method,body});
 if(path==='rpc/icash_prioritized_work'){assert.equal(body.p_account,account);return properties.slice(body.p_page*6,body.p_page*6+7);}
 const [table,params]=path.split('?');const q=new URLSearchParams(params);
 assert.equal(q.get('account_id'),`eq.${account}`,'Every read is tenant scoped');
 if(table==='icash_screening_jobs'){
  if(q.get('select')?.includes('!inner()'))return [{id:uuid(1)}];
  if(q.get('select')==='id,result:result->property')return properties.filter(p=>q.get('id').includes(p.id)).map(p=>({id:p.id,result:p.result.property}));
  if(q.get('id'))return properties.filter(p=>q.get('id')===`eq.${p.id}`);
  const search=q.get('result->property->>address')?.slice(7,-1).toLowerCase();
  return paginate(properties.filter(p=>!search||p.result.property.address.toLowerCase().includes(search)),q);
 }
 if(table==='icash_deal_files'){
  if(q.get('id'))return queue.filter(p=>q.get('id').includes(p.deal_id)).map(p=>({id:p.deal_id,screening_id:p.screening_id}));
  return [];
 }
 if(table==='icash_text_attention'||table==='icash_sms_call_requests'||table==='icash_handoffs')return paginate(queue,q);
 if(table==='icash_signing_envelopes')return q.get('state')?paginate(queue.map(p=>({id:p.id,deal_id:p.deal_id,kind:'purchase',test_mode:false})),q):[];
 if(['icash_owner_contacts','icash_property_controls','icash_live_conversations','icash_live_callbacks'].includes(table))return [];
 throw Error('Unexpected read '+table);
}};
globalThis.__activityRoute=mocks;
let source=ts.transpileModule(readFileSync(new URL('../app/api/work/activity/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
source=source.replace(/^import .* from .*;$/gm,'');
source='const {'+Object.keys(mocks).join(',')+'}=globalThis.__activityRoute;\n'+source;
const {GET}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const get=query=>GET(new Request('https://www.geticashx.com/api/work/activity'+query));
let r=await get('');assert.equal(r.status,200);assert.equal(r.body.properties.length,6);assert.equal(r.body.hasMore,true);assert.equal(r.body.textAttention.length,6);assert.deepEqual(r.body.propertyAttentionIds,[uuid(1)]);assert.equal(r.body.attentionHasMore,true);assert.equal(r.body.textAttention[0].address,'10 Main Street');assert.equal(r.body.signatureActions[0].screening_id,uuid(10));assert.equal(r.body.signatureActions[0].address,'10 Main Street');
assert(paths.find(x=>x.path.startsWith('icash_sms_call_requests')).path.includes('&limit=7&offset=0'));
assert(!paths.find(x=>x.path.startsWith('icash_sms_call_requests')).path.includes('screening_id=in.'),'Callback queue spans all property pages');
assert(paths.find(x=>x.path.startsWith('icash_handoffs')).path.includes('state=eq.open'),'Acknowledged handoffs cannot crowd out open requests');
paths=[];r=await get('?page=1&attentionPage=1');assert.equal(r.body.properties[0].id,uuid(7));assert.equal(r.body.textAttention[0].id,uuid(106));assert.deepEqual(r.body.propertyAttentionIds,[uuid(1)],'Property attention does not depend on current request page');assert.equal(r.body.attentionHasMore,true);
r=await get('?attentionPage=2');assert.equal(r.body.textAttention.length,2);assert.equal(r.body.attentionHasMore,false);
r=await get('?query=20%20Main');assert.equal(r.status,200);assert.equal(r.body.properties.length,1);assert.equal(r.body.properties[0].id,uuid(20));assert.equal(r.body.searchSupported,true);assert.equal(r.body.hasMore,false);
r=await get('?screeningId='+uuid(20));assert.equal(r.body.properties.length,1);assert.equal(r.body.properties[0].id,uuid(20));assert.equal(r.body.hasMore,false);
r=await get('?screeningId='+otherAccount);assert.equal(r.body.properties.length,0,'Unknown or other-tenant identifiers never return another property');
for(const bad of ['?query=*','?query=%25','?query=abc%26account_id=eq.other','?query='+('a'.repeat(101))]){paths=[];r=await get(bad);assert.equal(r.status,400);assert.equal(paths.length,0,'Invalid search fails before any data query');}
for(const bad of ['?page=-1','?page=1.5','?page=Infinity','?attentionPage=10001','?screeningId=invalid']){paths=[];r=await get(bad);assert.notEqual(r.status,200);assert.equal(paths.length,0);}
authorized=false;paths=[];r=await get('');assert.notEqual(r.status,200);assert.equal(paths.length,0,'No data access without account ownership');
delete globalThis.__activityRoute;
console.log('Activity route: global queue pagination, off-page context, bounded tenant search, direct property lookup and ownership gates passed. No external calls.');
