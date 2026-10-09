import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';
import {recordedDealProgress} from '../lib/deal-card-summary.ts';
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const account=uuid(999),otherAccount=uuid(998);
const property=n=>({id:uuid(n),state:'complete',completed_at:'2026-09-30T10:00:00Z',result:{property:{propertyId:`prop_${n}`,address:`${n} Main Street`},financialCheck:{status:'eligible',reason:'Fixture'},preliminarySellerCeilingCents:100000}});
const properties=Array.from({length:20},(_,i)=>property(i+1));
const queue=Array.from({length:14},(_,i)=>({id:uuid(100+i),screening_id:uuid(10+i),deal_id:uuid(200+i),state:'open',kind:'human',party:'seller'}));
const lookup=(n,people)=>({account_id:account,screening_id:uuid(n),created_at:'2026-10-01T01:02:03Z',lookup_at:'2026-10-01T01:01:02Z',people});
const person={name:'Synthetic Person',personId:'per_private',emails:['private@example.invalid'],address:'Private extra address',ownershipVerified:true,outreachAuthorized:true,
 phones:[{number:'+12025550101',type:'Mobile',doNotCall:true,permission:'granted',extra:'Private phone field'},
 {number:'+12025550102',type:'Landline',doNotCall:false},{number:'+12025550103',doNotCall:null},{number:'+12025550104',doNotCall:'false'},{}]};
const contactRows=[lookup(1,[person,{},null,'invalid',{name:34,phones:'invalid'}]),lookup(7,[{name:'Page two contact',phones:[]}]),lookup(20,[{name:'Retained contact',phones:[]}]),
 {...lookup(998,[{name:'Other tenant contact',phones:[]}]),account_id:otherAccount}];
let paths=[],authorized=true,sellerFixtures=[],dealFixtures=[];
const paginate=(rows,q)=>rows.slice(Number(q.get('offset')??0),Number(q.get('offset')??0)+Number(q.get('limit')??rows.length));
const mocks={z,recordedDealProgress,NextResponse:{json:(body,options={})=>({body,status:options.status??200,headers:options.headers})},workAccount:async()=>{if(!authorized)throw Error();return {accountId:account};},db:async(path,method,body)=>{
 paths.push({path,method,body});
 if(path==='rpc/icash_buyer_reception_calls'){assert.equal(body.p_account,account);return [];}
 if(path==='rpc/icash_sms_route_review_items'){assert.equal(body.p_account,account);assert.equal(body.p_limit,7);return queue.slice(body.p_offset,body.p_offset+body.p_limit).map((q,i)=>({message_id:q.id,recipient:'+12145550123',body:'Which property?',revision:7,needs_review:true,candidates:[]}));}
 const [table,params]=path.split('?');const q=new URLSearchParams(params);
 assert.equal(q.get(table==='icash_seller_intakes'?'assigned_account':'account_id'),`eq.${account}`,'Every read is tenant scoped');
 if(table==='icash_screening_jobs'){
  if(q.get('select')?.includes('!inner()'))return [{id:uuid(1)}];
  if(q.get('select')==='id,result:result->property')return properties.filter(p=>q.get('id').includes(p.id)).map(p=>({id:p.id,result:p.result.property}));
  if(q.get('id'))return properties.filter(p=>q.get('id')===`eq.${p.id}`);
  const search=q.get('result->property->>address')?.slice(7,-1).toLowerCase();
  return paginate(properties.filter(p=>!search||p.result.property.address.toLowerCase().includes(search)),q);
 }
 if(table==='icash_deal_files'){
  if(q.get('id'))return queue.filter(p=>q.get('id').includes(p.deal_id)).map(p=>({id:p.deal_id,screening_id:p.screening_id}));
  if(dealFixtures.length){for(const alias of ['deposit','scheduled','payment']){assert.equal(q.get(alias+'.account_id'),'eq.'+account);assert.equal(q.get(alias+'.limit'),'1');}assert.equal(q.get('scheduled.kind'),'eq.closing_scheduled');assert.equal(q.get('payment.kind'),'eq.funds_disbursed');}
  return dealFixtures.filter(d=>q.get('screening_id').includes(d.screening_id));
 }
 if(table==='icash_buyer_viewing_requests')return [];
 if(table==='icash_text_attention'||table==='icash_sms_call_requests'||table==='icash_handoffs')return paginate(queue,q);
 if(table==='icash_buyer_viewing_requests')return [];
 if(table==='icash_seller_gaps')return paginate(queue.map(item=>({...item,reason:'unanswered',quote:'An exact seller question',updated_at:'2026-10-09T12:00:00Z'})),q);
 if(table==='icash_signing_envelopes')return q.get('state')?paginate(queue.map(p=>({id:p.id,deal_id:p.deal_id,kind:'purchase',test_mode:false})),q):[];
 if(table==='icash_owner_contacts'){
  assert.equal(q.get('select'),'account_id,screening_id,created_at,lookup_at:result->>fetchedAt,people:result->contacts');
  assert.equal(q.get('limit'),'6','Contact lookups stay bounded to the property page');
  const ids=q.get('screening_id');assert.ok(ids.startsWith('in.('));
  const selected=contactRows.filter(row=>row.account_id===account&&ids.includes(row.screening_id));
  // Defense in depth: even an unexpected database row cannot escape projection.
  return [...selected,{...lookup(1,[{name:'Wrong account row',phones:[]}]),account_id:otherAccount},lookup(19,[{name:'Nonvisible contact',phones:[]}])];
 }
 if(table==='icash_seller_matches'){assert.equal(q.get('account_id'),'eq.'+account);assert.equal(q.get('select'),'account_id,screening_id,lead:icash_seller_intakes(name,phone)');return sellerFixtures;}
 if(['icash_property_controls','icash_live_conversations','icash_live_callbacks'].includes(table))return [];
 throw Error('Unexpected read '+table);
}};
globalThis.__activityRoute=mocks;
let source=ts.transpileModule(readFileSync(new URL('../app/api/work/activity/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
source=source.replace(/^import .* from .*;$/gm,'');
source='const {'+Object.keys(mocks).join(',')+'}=globalThis.__activityRoute;\n'+source;
const {GET}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const get=query=>GET(new Request('https://www.geticashx.com/api/work/activity'+query));
let r=await get('');assert.equal(r.status,200);assert.equal(r.body.properties.length,6);assert.equal(r.body.hasMore,true);assert.equal(r.body.textAttention.length,6);assert.deepEqual(r.body.propertyAttentionIds,[uuid(1)]);assert.equal(r.body.attentionHasMore,true);assert.equal(r.body.textAttention[0].address,'10 Main Street');assert.equal(r.body.signatureActions[0].screening_id,uuid(10));assert.equal(r.body.signatureActions[0].address,'10 Main Street');
assert.equal(r.body.smsRouteReviews.length,6);assert.equal(r.body.smsRouteReviews[0].needs_review,true);
assert.equal(r.body.sellerRecovery.length,6);assert.equal(r.body.sellerRecovery[0].address,'10 Main Street');assert.equal(r.body.sellerRecovery[0].quote,'An exact seller question');
assert.equal(r.headers['Cache-Control'],'private, no-store');
assert.deepEqual(r.body.contacts,[{screening_id:uuid(1),created_at:'2026-10-01T01:02:03.000Z',fetchedAt:'2026-10-01T01:01:02.000Z',source:'DealMachine',ownershipVerified:false,outreachAuthorized:false,
 contacts:[{name:'Synthetic Person',phones:[{number:'+12025550101',type:'Mobile',doNotCall:true},{number:'+12025550102',type:'Landline',doNotCall:false},{number:'+12025550103',type:null,doNotCall:null},{number:'+12025550104',type:null,doNotCall:null},{number:null,type:null,doNotCall:null}]},{name:null,phones:[]},{name:null,phones:[]}]}]);
assert.doesNotMatch(JSON.stringify(r.body.contacts),/private|Private|Other tenant|Wrong account|Nonvisible|Page two|Retained/);
assert(paths.find(x=>x.path.startsWith('icash_sms_call_requests')).path.includes('&limit=7&offset=0'));
assert(!paths.find(x=>x.path.startsWith('icash_sms_call_requests')).path.includes('screening_id=in.'),'Callback queue spans all property pages');
assert(paths.find(x=>x.path.startsWith('icash_handoffs')).path.includes('state=eq.open'),'Acknowledged handoffs cannot crowd out open requests');
paths=[];r=await get('?page=1&attentionPage=1');assert.equal(r.body.properties[0].id,uuid(7));assert.equal(r.body.textAttention[0].id,uuid(106));assert.deepEqual(r.body.propertyAttentionIds,[uuid(1)],'Property attention does not depend on current request page');assert.equal(r.body.attentionHasMore,true);
assert.deepEqual(r.body.contacts.map(c=>c.screening_id),[uuid(7)]);
r=await get('?attentionPage=2');assert.equal(r.body.textAttention.length,2);assert.equal(r.body.attentionHasMore,false);
r=await get('?query=20%20Main');assert.equal(r.status,200);assert.equal(r.body.properties.length,1);assert.equal(r.body.properties[0].id,uuid(20));assert.equal(r.body.searchSupported,true);assert.equal(r.body.hasMore,false);
assert.equal(r.body.contacts[0].contacts[0].name,'Retained contact');
r=await get('?screeningId='+uuid(20));assert.equal(r.body.properties.length,1);assert.equal(r.body.properties[0].id,uuid(20));assert.equal(r.body.hasMore,false);
assert.deepEqual(r.body.contacts.map(c=>c.screening_id),[uuid(20)],'Retained property read returns only that property’s purchased lookup');
paths=[];r=await get('?screeningId='+otherAccount);assert.equal(r.body.properties.length,0,'Unknown or other-tenant identifiers never return another property');assert.deepEqual(r.body.contacts,[]);assert(!paths.some(x=>x.path.startsWith('icash_owner_contacts')));
for(const people of [null,undefined,{},'invalid',42]){contactRows[0].people=people;contactRows[0].lookup_at='invalid';contactRows[0].created_at=null;r=await get('');assert.deepEqual(r.body.contacts[0].contacts,[]);assert.equal(r.body.contacts[0].fetchedAt,null);assert.equal(r.body.contacts[0].created_at,null);}
contactRows[0].people=Array.from({length:30},()=>({name:'x'.repeat(250),phones:Array.from({length:25},()=>({number:'1'.repeat(40),type:'x'.repeat(40),doNotCall:1}))}));r=await get('');
assert.equal(r.body.contacts[0].contacts.length,25);assert.equal(r.body.contacts[0].contacts[0].name.length,200);assert.equal(r.body.contacts[0].contacts[0].phones.length,20);assert.equal(r.body.contacts[0].contacts[0].phones[0].number.length,30);assert.equal(r.body.contacts[0].contacts[0].phones[0].type.length,30);assert.equal(r.body.contacts[0].contacts[0].phones[0].doNotCall,null);
for(const bad of ['?query=*','?query=%25','?query=abc%26account_id=eq.other','?query='+('a'.repeat(101))]){paths=[];r=await get(bad);assert.equal(r.status,400);assert.equal(paths.length,0,'Invalid search fails before any data query');}
for(const bad of ['?page=-1','?page=1.5','?page=Infinity','?attentionPage=10001','?screeningId=invalid']){paths=[];r=await get(bad);assert.notEqual(r.status,200);assert.equal(paths.length,0);}
sellerFixtures=[{account_id:account,screening_id:uuid(1),lead:{name:'Assigned seller',phone:'+12025550111'}},{account_id:otherAccount,screening_id:uuid(1),lead:{name:'Wrong seller',phone:'+12025550112'}},{account_id:account,screening_id:uuid(19),lead:{name:'Nonvisible seller',phone:'+12025550113'}}];
r=await get('');const shared=r.body.contacts.find(c=>c.source==='HomeOffer Network · seller-submitted');assert.equal(shared.contacts[0].name,'Assigned seller');assert.equal(shared.created_at,null);assert.equal(shared.fetchedAt,null);assert(!JSON.stringify(r.body).includes('Wrong seller'));assert(!JSON.stringify(r.body).includes('Nonvisible seller'));
const proof={account_id:account,deal_id:uuid(501)};
dealFixtures=[{id:uuid(501),screening_id:uuid(1),stage:'closing',terms:{priceCents:10000000},deposit:[proof],scheduled:[{...proof,effective_date:'2026-10-23'}],payment:[]}];
r=await get('');assert.equal(r.status,200);assert.deepEqual(r.body.deals[0].progress,{depositConfirmed:true,closingScheduledDate:'2026-10-23',paymentSent:false});
assert.ok(!('deposit' in r.body.deals[0])&&!('scheduled' in r.body.deals[0])&&!('payment' in r.body.deals[0]),'Only projected progress leaves the API');
dealFixtures[0].deposit=[{...proof,account_id:otherAccount}];dealFixtures[0].scheduled=[{...proof,deal_id:uuid(502),effective_date:'2026-10-23'}];
r=await get('');assert.deepEqual(r.body.deals[0].progress,{depositConfirmed:false,closingScheduledDate:null,paymentSent:false},'Other accounts and other deals cannot advance this card');
dealFixtures=[];
authorized=false;paths=[];r=await get('');assert.notEqual(r.status,200);assert.equal(paths.length,0,'No data access without account ownership');
delete globalThis.__activityRoute;
console.log('Activity route: tenant-bound purchased contacts, explicit field projection, DNC states, missing/malformed results, bounded arrays, pagination, retained views, search and authentication passed. Synthetic fixtures only.');
