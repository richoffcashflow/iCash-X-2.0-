// Owner-authorized new template versions only. Never creates a signing submission.
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
export async function prepareNoEmdTemplates(env=process.env,fetcher=fetch){
 if(env.VERCEL_ENV!=='production'||env.ICASH_DIRECT_CALLS_PREPARE!=='true')return {status:'not_requested'};
 const config=JSON.parse(await readFile(new URL('../config/signing-templates/purchase-config.json',import.meta.url),'utf8'));
 const base=JSON.parse(await readFile(new URL('../config/signing-templates/purchase.json',import.meta.url),'utf8'));
 if(/earnest|\bEMD\b/i.test(base.html)||Object.hasOwn(config.fieldMap,'earnestCents'))throw Error('NO_EMD_TEMPLATE_REQUIRED');
 if(!env.SUPABASE_URL||!env.SUPABASE_SECRET_KEY)throw Error('DATABASE_CONFIGURATION_REQUIRED');
 async function db(path,method='GET',body){
  const r=await fetcher(env.SUPABASE_URL+'/rest/v1/'+path,{method,headers:{apikey:env.SUPABASE_SECRET_KEY,Authorization:'Bearer '+env.SUPABASE_SECRET_KEY,'Content-Type':'application/json',Prefer:'return=representation'},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('TEMPLATE_DATABASE_UNCONFIRMED');const text=await r.text();return text?JSON.parse(text):null;
 }
 const results=[];
 for(const mode of ['live','test']){
  const task='icash-x-'+mode+'-purchase-no-emd-v1';
  const name='iCash X - Contract to Purchase'+(mode==='test'?' - TEST DRAFT':'');
  const rows=await db('icash_template_drafts?key=eq.'+task+'&select=state,result');
  if(rows.length!==1||rows[0].result?.ownerApproval?.approved!==true)throw Error('TEMPLATE_TASK_REQUIRED');
  const key=mode==='live'?env.DOCUSEAL_API_KEY:env.DOCUSEAL_TEST_API_KEY;if(!key)throw Error('SIGNING_CONFIGURATION_REQUIRED');
  if(rows[0].state==='created'&&rows[0].result.fieldValidation===true){
   const prior=rows[0].result,id=prior.id;
   if(prior.name!==name){
    if(!Number.isSafeInteger(id)||id<=0)throw Error('TEMPLATE_ID_REQUIRED');
    const request=async(method='GET',body)=>{const r=await fetcher('https://api.docuseal.com/templates/'+id,{method,headers:{'X-Auth-Token':key,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('TEMPLATE_TITLE_UNCONFIRMED');return r.json();};
    const before=await request();
    if(before.id!==id||before.external_id!==task)throw Error('TEMPLATE_BINDING_REQUIRED');
    // A display-name update only: no document, field, role, submission or notification changes.
    if(before.name!==name)await request('PUT',{name});
    const after=await request();
    if(after.id!==id||after.name!==name||after.external_id!==task||JSON.stringify([after.fields,after.submitters,after.schema])!==JSON.stringify([before.fields,before.submitters,before.schema]))throw Error('TEMPLATE_TITLE_READBACK_REQUIRED');
    await db('icash_template_drafts?key=eq.'+task,'PATCH',{result:{...prior,name},updated_at:new Date().toISOString()});
   }
   results.push({mode,id,status:'already_created'});continue;
  }
  if(rows[0].state!=='claimed')throw Error('PRIOR_TEMPLATE_CREATE_UNCONFIRMED');
  const payload={...base,external_id:task,name,folder_name:mode==='live'?'iCash X Approved Contracts':'iCash X Test Contracts',shared_link:false};
  if(mode==='live')payload.html=payload.html.replaceAll('TEST DRAFT - NOT FOR A LIVE TRANSACTION','').replaceAll('This draft is not an attorney-approved state form.','This agreement is not an attorney-approved state form.');
  const claim=await db('icash_template_drafts?key=eq.'+task+'&state=eq.claimed','PATCH',{state:'needs_review',updated_at:new Date().toISOString()});
  if(claim.length!==1)throw Error('TEMPLATE_CLAIM_REQUIRED');
  const headers={'X-Auth-Token':key,'Content-Type':'application/json'};
  const made=await fetcher('https://api.docuseal.com/templates/html',{method:'POST',headers,body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(45000)});
  if(!made.ok)throw Error('TEMPLATE_CREATE_UNCONFIRMED_'+made.status);
  const created=await made.json();if(!Number.isSafeInteger(created.id))throw Error('TEMPLATE_ID_REQUIRED');
  // Persist the ID before readback so an interrupted request is reconciled, never repeated.
  await db('icash_template_drafts?key=eq.'+task,'PATCH',{result:{ownerApproval:rows[0].result.ownerApproval,id:created.id,productionEnabled:false}});
  const read=await fetcher('https://api.docuseal.com/templates/'+created.id,{headers,redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!read.ok)throw Error('TEMPLATE_READBACK_REQUIRED');const d=await read.json();
  const fields=d.fields??[],roles=d.submitters??[];
  const valid=d.id===created.id&&d.external_id===task&&roles.length===config.roles.length&&config.roles.every(name=>{
   const role=roles.find(r=>r.name===name);return role&&['signature','checkbox'].every(type=>fields.some(f=>f.submitter_uuid===role.uuid&&f.type===type&&f.required));
  })&&Object.values(config.fieldMap).every(name=>fields.filter(f=>f.name===name&&f.readonly===true).length===1)&&!fields.some(f=>/earnest|\bEMD\b/i.test(f.name));
  await db('icash_template_drafts?key=eq.'+task,'PATCH',{state:valid?'created':'needs_review',result:{ownerApproval:rows[0].result.ownerApproval,id:d.id,name:d.name,external_id:task,roles:roles.map(r=>({name:r.name,uuid:r.uuid})),fields:fields.map(f=>({name:f.name,type:f.type,required:f.required,readonly:f.readonly,submitter_uuid:f.submitter_uuid,areas:f.areas})),documents:d.documents,fieldValidation:valid,productionEnabled:false},updated_at:new Date().toISOString()});
  if(!valid)throw Error('TEMPLATE_FIELDS_UNCONFIRMED');results.push({mode,id:d.id,status:'created'});
 }
 return {status:'prepared',templates:results};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{console.log('No EMD templates:',JSON.stringify(await prepareNoEmdTemplates()));}catch(e){console.error('No EMD template preparation failed:',e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'UNCONFIRMED');process.exitCode=1;}}
