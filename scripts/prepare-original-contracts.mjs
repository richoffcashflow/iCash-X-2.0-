// Owner-requested replacement forms. Creates templates only; never sends or signs.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const digest=b=>createHash('sha256').update(b).digest('hex');
export function originalTemplateValid(d,form,task){
 const roles=d.submitters??[],fields=d.fields??[];
 return d.external_id===task&&d.shared_link===false&&d.schema?.length===1&&d.documents?.length===1
  &&roles.length===form.roles.length&&fields.length===form.fields.length&&form.roles.every(r=>roles.some(s=>s.name===r))
  &&form.fields.every(expected=>{
   const found=fields.filter(f=>f.name===expected.name),f=found[0],role=roles.find(r=>r.name===expected.role);
   return found.length===1&&f.type===expected.type&&f.submitter_uuid===role?.uuid&&f.required===expected.required
    &&(expected.type!=='text'||f.readonly===true)&&f.areas?.length===expected.areas.length
    &&f.areas.every((a,i)=>a.page===expected.areas[i].page&&['x','y','w','h'].every(k=>Math.abs(a[k]-expected.areas[i][k])<0.000001));
  });
}
export async function prepareOriginalContracts(env=process.env,fetcher=fetch){
 if(env.VERCEL_ENV!=='production'||env.ICASH_DIRECT_CALLS_PREPARE!=='true')return {status:'not_requested'};
 const forms=JSON.parse(await readFile(new URL('../config/signing-templates/owner-originals.json',import.meta.url),'utf8'));
 if(!env.SUPABASE_URL||!env.SUPABASE_SECRET_KEY)throw Error('ORIGINAL_FORMS_DATABASE_REQUIRED');
 const db=async(path,method='GET',body)=>{
  const r=await fetcher(env.SUPABASE_URL+'/rest/v1/'+path,{method,headers:{apikey:env.SUPABASE_SECRET_KEY,Authorization:'Bearer '+env.SUPABASE_SECRET_KEY,'Content-Type':'application/json',Prefer:'return=representation'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('ORIGINAL_FORMS_DATABASE_UNCONFIRMED');const text=await r.text();return text?JSON.parse(text):null;
 };
 const results=[];
 for(const mode of ['test','live'])for(const kind of ['purchase','assignment']){
  const form=forms[kind],task=`icash-x-original-20261009-${mode}-${kind}-v1`,path='icash_template_drafts?key=eq.'+task;
  const [row]=await db(path+'&select=state,result');
  if(!row)continue; // An installed script alone never grants a template-creation authorization.
  if(row.result?.ownerApproval?.approved!==true||row.result.ownerApproval.sourceSha256!==form.source.sourceSha256)throw Error('ORIGINAL_FORM_APPROVAL_REQUIRED');
  const key=mode==='test'?env.DOCUSEAL_TEST_API_KEY:env.DOCUSEAL_API_KEY;if(!key)throw Error('ORIGINAL_FORM_PROVIDER_KEY_REQUIRED');
  const request=async(path,method='GET',body)=>{
   const r=await fetcher('https://api.docuseal.com/'+path,{method,headers:{'X-Auth-Token':key,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(45000)});
   if(!r.ok)throw Error('ORIGINAL_FORM_PROVIDER_HTTP_'+r.status);return r.json();
  };
  if(row.state==='created'){
   const d=await request('templates/'+row.result.id);
   if(!originalTemplateValid(d,form,task))throw Error('ORIGINAL_FORM_READBACK_MISMATCH');
   results.push({mode,kind,id:d.id,status:'already_created'});continue;
  }
  let id=row.result.id;
  if(!id){
   if(row.state!=='claimed')throw Error('ORIGINAL_FORM_CREATE_OUTCOME_UNKNOWN');
   const bytes=await readFile(new URL(`../public/contracts/owner-20261009/${kind}.pdf`,import.meta.url));
   if(digest(bytes)!==form.source.pdfSha256)throw Error('ORIGINAL_FORM_SOURCE_CHANGED');
   const claim=await db(path+'&state=eq.claimed','PATCH',{state:'needs_review',updated_at:new Date().toISOString()});
   if(claim.length!==1)throw Error('ORIGINAL_FORM_CLAIM_REQUIRED');
   const d=await request('templates/pdf','POST',{name:form.title+(mode==='test'?' - TEST':''),external_id:task,folder_name:mode==='test'?'iCash X Test Contracts':'iCash X Approved Contracts',shared_link:false,documents:[{name:form.title,file:bytes.toString('base64')}]});
   if(!Number.isSafeInteger(d.id)||d.id<=0)throw Error('ORIGINAL_FORM_ID_REQUIRED');id=d.id;
   await db(path,'PATCH',{result:{...row.result,id,productionEnabled:false},updated_at:new Date().toISOString()});
  }
  const before=await request('templates/'+id);
  if(before.external_id!==task||before.schema?.length!==1||before.shared_link!==false)throw Error('ORIGINAL_FORM_BINDING_REQUIRED');
  const roles=form.roles.map(name=>{const h=digest(`${task}:${name}`);return {name,uuid:`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`};});
  const fields=form.fields.map((f,i)=>{const h=digest(`${task}:field:${i}`);const {role,...field}=f;return {...field,uuid:`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`,submitter_uuid:roles.find(r=>r.name===role).uuid,areas:f.areas.map(a=>({...a,attachment_uuid:before.schema[0].attachment_uuid}))};});
  await request('templates/'+id,'PUT',{submitters:roles,fields});
  const d=await request('templates/'+id);
  if(!originalTemplateValid(d,form,task))throw Error('ORIGINAL_FORM_FIELDS_UNCONFIRMED');
  await db(path,'PATCH',{state:'created',result:{...row.result,id,name:d.name,external_id:task,roles:d.submitters,fields:d.fields,documents:d.documents,source:form.source,fieldValidation:true,productionEnabled:false},updated_at:new Date().toISOString()});
  results.push({mode,kind,id,status:'created'});
 }
 return {status:'prepared',templates:results};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{console.log('Original contract templates:',JSON.stringify(await prepareOriginalContracts()));}catch(e){console.error('Original contract preparation:',e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'UNCONFIRMED');process.exitCode=1;}}
