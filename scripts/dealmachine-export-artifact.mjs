import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {activeExportProbeProvider} from './verify-dealmachine-active-export.mjs';

export function parseExportCsv(text){
 if(typeof text!=='string'||Buffer.byteLength(text)>65536)throw Error('EXPORT_FILE_TOO_LARGE');
 const rows=[];let row=[],cell='',quoted=false,closed=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
  if(c==='"'){if(cell||closed)throw Error('EXPORT_CSV_INVALID');quoted=true;continue;}
  if(c===','||c==='\n'||c==='\r'){
   row.push(cell);cell='';closed=false;
   if(c!==','){rows.push(row);row=[];if(c==='\r'&&text[i+1]==='\n')i++;}
   continue;
  }
  if(closed)throw Error('EXPORT_CSV_INVALID');cell+=c;
 }
 if(quoted)throw Error('EXPORT_CSV_INVALID');
 if(cell||row.length||closed){row.push(cell);rows.push(row);}
 if(rows[0]?.[0])rows[0][0]=rows[0][0].replace(/^\uFEFF/,'');
 if(rows.length!==2||rows[0].length!==rows[1].length||rows[0].length>150||new Set(rows[0]).size!==rows[0].length)throw Error('EXPORT_CSV_SCOPE_INVALID');
 return rows;
}
const knownPhoneKeys=new Set(['number','phone','phone_number','type','phone_type','do_not_call','dnc','carrier','active','is_active','activity','status','phone_activity','phone_activity_status','last_seen','last_seen_date','last_active','last_activity_date']);
function schemaKeys(keys){
 const unique=[...new Set(keys)];
 // A provider may encode a dictionary keyed by phone number or name. Only
 // recognized schema labels belong in build logs; the original stays private.
 return {keys:unique.filter(k=>knownPhoneKeys.has(k)),otherKeyCount:unique.filter(k=>!knownPhoneKeys.has(k)).length};
}
function shape(value,personId){
 if(value==='')return {type:'empty'};
 if(value===personId||value===personId.slice(4))return {type:'requested_owner_id'};
 if(/^(?:true|false|yes|no|wireless|landline|mobile|active|inactive|unknown)$/i.test(value))return {type:'literal',value:value.toLowerCase()};
 try{
  const parsed=JSON.parse(value);
  if(Array.isArray(parsed)){
   const {keys,otherKeyCount}=schemaKeys(parsed.flatMap(x=>x&&typeof x==='object'&&!Array.isArray(x)?Object.keys(x):[]));
   return {type:'json_array',length:parsed.length,itemTypes:[...new Set(parsed.map(x=>x===null?'null':Array.isArray(x)?'array':typeof x))],objectKeys:keys,otherKeyCount};
  }
  if(parsed&&typeof parsed==='object')return {type:'json_object',...schemaKeys(Object.keys(parsed))};
 }catch{}
 if(/^[+\d(). -]+$/.test(value))return {type:'numeric_text',digits:value.replace(/\D/g,'').length};
 return {type:'text',length:value.length};
}
/** Free read of the original approved export only. No export creation or retry. */
export async function inspectSavedActiveExport({db,transport=fetch}){
 const path=`icash_integration_checks?provider=eq.${activeExportProbeProvider}`;
 const rows=await db(path+'&select=result'),saved=rows?.[0]?.result;
 if(rows?.length!==1||saved?.status!=='response_saved'||saved.httpStatus!==200)return {status:'no_completed_export'};
 if(saved.artifact)return {status:'already_saved',...saved.artifact.summary};
 const receipt=saved.receipt,files=receipt?.download_urls;
 if(saved.request?.people_ids?.length!==1||saved.request.people_ids[0]!==saved.personId||receipt?.record_count!==1||!Array.isArray(files)||files.length!==1)throw Error('EXPORT_FILE_SCOPE_INVALID');
 const url=new URL(files[0].url);
 if(url.protocol!=='https:'||url.hostname!=='storage.googleapis.com'||url.username||url.password||(url.port&&url.port!=='443'))throw Error('EXPORT_DOWNLOAD_HOST_INVALID');
 const response=await transport(url,{method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
 if(!response.ok||!response.body)throw Error('EXPORT_DOWNLOAD_UNAVAILABLE');
 const reader=response.body.getReader(),parts=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>1048576)throw Error('EXPORT_FILE_TOO_LARGE');parts.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>null);}
 const bytes=Buffer.concat(parts),plain=bytes[0]===0x1f&&bytes[1]===0x8b?gunzipSync(bytes,{maxOutputLength:65536}):bytes;
 const csv=plain.toString('utf8'),[headers,values]=parseExportCsv(csv);
 if(headers.some(h=>! /^[a-zA-Z_][a-zA-Z0-9 _()./-]{0,119}$/.test(h)))throw Error('EXPORT_HEADER_INVALID');
 const summary={rowCount:1,columns:headers.map((header,i)=>({header,...shape(values[i],saved.personId)})),creditKeys:Object.keys(receipt.credits??{})};
 const artifact={csv,sha256:createHash('sha256').update(csv).digest('hex'),summary,savedAt:new Date().toISOString()};
 const updated=await db(path+`&result->>status=eq.response_saved&result->>runId=eq.${saved.runId}&result->artifact=is.null`,'PATCH',{checked_at:new Date().toISOString(),result:{...saved,artifact}});
 if(!Array.isArray(updated)||updated.length!==1)throw Error('EXPORT_ARTIFACT_RECONCILIATION_REQUIRED');
 return {status:'saved',...summary};
}
