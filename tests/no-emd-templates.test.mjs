import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareNoEmdTemplates} from '../scripts/prepare-no-emd-templates.mjs';
const config=JSON.parse(readFileSync(new URL('../config/signing-templates/purchase-config.json',import.meta.url)));
const base=JSON.parse(readFileSync(new URL('../config/signing-templates/purchase.json',import.meta.url)));
assert.equal(base.html,readFileSync(new URL('../config/signing-templates/purchase.html',import.meta.url),'utf8'));
assert(!/earnest|\bEMD\b/i.test(base.html));assert(base.html.includes('security deposits'),'tenant provisions remain intact');
assert(readFileSync(new URL('../config/signing-templates/assignment.html',import.meta.url),'utf8').includes('assignmentDepositCents'));
const env={VERCEL_ENV:'production',ICASH_DIRECT_CALLS_PREPARE:'true',SUPABASE_URL:'https://db.invalid',SUPABASE_SECRET_KEY:'fixture',DOCUSEAL_API_KEY:'live-fixture',DOCUSEAL_TEST_API_KEY:'test-fixture'};
for(const scenario of ['ok','missing_signature','interrupted']){
 const tasks=new Map(['live','test'].map(mode=>['icash-x-'+mode+'-purchase-no-emd-v1',{state:scenario==='interrupted'?'needs_review':'claimed',result:{ownerApproval:{approved:true}}}]));
 let creates=0;const templates=new Map();
 const fetcher=async(url,init)=>{
  const u=new URL(url),body=init.body?JSON.parse(init.body):null;
  assert(!/submissions|submitters/.test(u.pathname),'template preparation never sends signing requests');
  if(u.hostname==='db.invalid'){
   const task=tasks.get(u.searchParams.get('key').slice(3));assert(task);
   if(init.method==='PATCH'){if(u.searchParams.get('state')&&task.state!=='claimed')return Response.json([]);Object.assign(task,body);}
   return Response.json([task]);
  }
  assert.equal(u.hostname,'api.docuseal.com');
  if(init.method==='POST'){
   creates++;assert.equal(body.shared_link,false);assert(!/earnest|\bEMD\b/i.test(body.html));
   assert.equal(body.html.includes('TEST DRAFT - NOT FOR A LIVE TRANSACTION'),init.headers['X-Auth-Token']==='test-fixture');
   const roles=config.roles.map((name,i)=>({name,uuid:'role'+i}));
   const fields=[...Object.values(config.fieldMap).map(name=>({name,type:'text',readonly:true,submitter_uuid:'role0'})),...roles.flatMap(r=>['signature','checkbox'].map(type=>({name:r.name+' '+type,type,required:scenario!=='missing_signature',submitter_uuid:r.uuid})))];
   const d={id:creates,external_id:body.external_id,submitters:roles,fields,documents:[]};templates.set(creates,d);return Response.json(d);
  }
  return Response.json(templates.get(Number(u.pathname.split('/').at(-1))));
 };
 if(scenario==='ok'){
  assert.equal((await prepareNoEmdTemplates(env,fetcher)).status,'prepared');assert.equal(creates,2);
  await prepareNoEmdTemplates(env,fetcher);assert.equal(creates,2,'rebuild cannot repeat provider creation');
  assert([...tasks.values()].every(t=>t.state==='created'&&t.result.productionEnabled===false));
 }else{
  await assert.rejects(prepareNoEmdTemplates(env,fetcher),scenario==='interrupted'?/PRIOR_TEMPLATE_CREATE_UNCONFIRMED/:/TEMPLATE_FIELDS_UNCONFIRMED/);
  assert.equal(creates,scenario==='interrupted'?0:1);
 }
}
assert.equal((await prepareNoEmdTemplates({...env,VERCEL_ENV:'preview'},()=>{throw Error('UNEXPECTED_NETWORK');})).status,'not_requested');
console.log('PASS no-EMD template fields, required signatures, live/test isolation, no automatic repeat and no submission creation.');
