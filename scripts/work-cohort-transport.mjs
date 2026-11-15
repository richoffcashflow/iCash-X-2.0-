// Optional private transport only: render/read/verify. Never execute SQL or append.
import {createHash,randomBytes} from 'node:crypto';
import {constants,openSync,closeSync,fstatSync,readSync,writeFileSync,statSync,realpathSync,mkdtempSync,rmSync,unlinkSync} from 'node:fs';
import {dirname,join,resolve,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {renderCohortQuery} from './work-cohort.mjs';

export const FORMAT='work-cohort-pgp-json-v1';
export const MAX_RAW_BYTES=32*1024*1024,MAX_ENCRYPTED_BYTES=MAX_RAW_BYTES+65536;
const MAX_ENVELOPE_BYTES=Math.ceil(MAX_ENCRYPTED_BYTES*4/3)+1024*1024;
const sha=data=>createHash('sha256').update(data).digest('hex');
class TransportError extends Error{}
const need=(ok,code)=>{if(!ok)throw new TransportError(code);};
const json=bytes=>{try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new TransportError('INVALID_JSON');}};
const members=baseline=>{
 const ids=baseline?.accounts?.map(a=>a?.id).sort();
 need(Array.isArray(ids)&&ids.length>0&&ids.length<=10000&&new Set(ids).size===ids.length&&ids.every(id=>typeof id==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id)),'INVALID_FIXED_COHORT');
 return ids;
};
const validKey=key=>need(typeof key==='string'&&/^[0-9a-f]{64}$/.test(key),'INVALID_EPHEMERAL_KEY');
const originalQuery=baseline=>renderCohortQuery(baseline);

export function renderTransportQuery(baseline,key){
 members(baseline);validKey(key);
 const original=originalQuery(baseline),start=original.indexOf('with fixed_members'),end=original.lastIndexOf(';\ncommit;');
 need(start>0&&end>start&&original.slice(0,start).endsWith("begin read only;\nset local statement_timeout='20s';\n")&&original.slice(end)===';\ncommit;\n','OBSERVER_QUERY_SHAPE_CHANGED');
 // Copy the complete original SELECT byte-for-byte, minus its terminator.
 return original.slice(0,start)+`with complete_observation as materialized (\n${original.slice(start,end)}\n), serialized_observation as materialized (
 select convert_to(json_agg(complete_observation order by evidence->>'id')::text,'UTF8') payload,
 count(*) row_count,count(distinct evidence->>'id') distinct_member_count,
 min(observed_at) original_observed_at_min,max(observed_at) original_observed_at_max
 from complete_observation
), encrypted_observation as materialized (
 select s.*,extensions.pgp_sym_encrypt_bytea(payload,'${key}',
 'compress-algo=2,compress-level=6,cipher-algo=aes256') ciphertext
 from serialized_observation s
)
select '${FORMAT}' format,'${sha(original)}' query_sha256,'${sha(JSON.stringify(members(baseline)))}' membership_sha256,
 row_count,distinct_member_count,original_observed_at_min,original_observed_at_max,
 octet_length(payload) raw_bytes,encode(extensions.digest(payload,'sha256'),'hex') plaintext_sha256,
 octet_length(ciphertext) encrypted_bytes,encode(ciphertext,'base64') encrypted_base64
from encrypted_observation;
commit;
`;
}

export function createTransportManifest(baselineBytes,key){
 const baseline=json(baselineBytes),ids=members(baseline),sql=renderTransportQuery(baseline,key);
 return {format:FORMAT,baselineSha256:sha(baselineBytes),keySha256:sha(key),querySha256:sha(originalQuery(baseline)),wrappedQuerySha256:sha(sql),membershipSha256:sha(JSON.stringify(ids)),expectedMembers:ids.length,statementTimeout:'20s',readOnly:true};
}

export function verifyTransportSources(baselineBytes,key,sqlBytes,manifest){
 const expected=createTransportManifest(baselineBytes,key);
 need(manifest&&Object.keys(manifest).sort().join()===Object.keys(expected).sort().join()&&Object.entries(expected).every(([name,value])=>manifest[name]===value),'TRANSPORT_SOURCE_CHANGED');
 need(sha(sqlBytes)===expected.wrappedQuerySha256,'TRANSPORT_QUERY_CHANGED');
 return json(baselineBytes);
}

const timestamp=value=>{
 need(typeof value==='string','INVALID_ORIGINAL_TIME');
 const m=value.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/);
 need(m,'INVALID_ORIGINAL_TIME');
 const zone=m[4]==='Z'?'Z':m[4].length===3?m[4]+':00':m[4].length===5?m[4].slice(0,3)+':'+m[4].slice(3):m[4];
 const calendar=Date.parse(m[1]+'T00:00:00Z'),millis=Date.parse(m[1]+'T'+m[2]+zone);
 need(Number.isFinite(calendar)&&new Date(calendar).toISOString().slice(0,10)===m[1]&&Number.isFinite(millis)&&m[2]<'24:00:00','INVALID_ORIGINAL_TIME');
 return BigInt(millis)*1000n+BigInt((m[3]??'').padEnd(6,'0'));
};
const envelopeObject=input=>{
 const e=Array.isArray(input)&&input.length===1?input[0]:input;
 need(e&&typeof e==='object'&&!Array.isArray(e)&&e.format===FORMAT,'INVALID_TRANSPORT_ENVELOPE');return e;
};

export function validateEnvelope(baseline,input){
 const e=envelopeObject(input),ids=members(baseline);
 need(e.query_sha256===sha(originalQuery(baseline))&&e.membership_sha256===sha(JSON.stringify(ids)),'ENVELOPE_SOURCE_MISMATCH');
 need(e.row_count===ids.length&&e.distinct_member_count===ids.length,'ENVELOPE_MEMBERSHIP_MISMATCH');
 need(Number.isSafeInteger(e.raw_bytes)&&e.raw_bytes>0&&e.raw_bytes<=MAX_RAW_BYTES,'RAW_BYTE_BOUND');
 need(Number.isSafeInteger(e.encrypted_bytes)&&e.encrypted_bytes>0&&e.encrypted_bytes<=MAX_ENCRYPTED_BYTES,'ENCRYPTED_BYTE_BOUND');
 need(typeof e.plaintext_sha256==='string'&&/^[0-9a-f]{64}$/.test(e.plaintext_sha256),'INVALID_PLAINTEXT_DIGEST');
 need(timestamp(e.original_observed_at_min)===timestamp(e.original_observed_at_max),'ENVELOPE_TIME_MISMATCH');
 need(typeof e.encrypted_base64==='string'&&e.encrypted_base64.length<=MAX_ENVELOPE_BYTES,'CIPHERTEXT_BOUND');
 const encoded=e.encrypted_base64.replace(/\r?\n/g,'');
 need(encoded.length%4===0&&/^[A-Za-z0-9+/]*={0,2}$/.test(encoded),'INVALID_BASE64');
 const ciphertext=Buffer.from(encoded,'base64');
 need(ciphertext.toString('base64')===encoded&&ciphertext.length===e.encrypted_bytes,'CIPHERTEXT_LENGTH_MISMATCH');
 return {envelope:e,ciphertext};
}

export function verifyPlaintext(baseline,input,plaintext){
 const {envelope:e}=validateEnvelope(baseline,input);
 need(Buffer.isBuffer(plaintext)&&plaintext.length===e.raw_bytes&&sha(plaintext)===e.plaintext_sha256,'PLAINTEXT_INTEGRITY_FAILED');
 // Verify exact bytes before parsing; never reserialize evidence for output.
 const rows=json(plaintext),ids=members(baseline);
 need(Array.isArray(rows)&&rows.length===ids.length,'ROW_COUNT_MISMATCH');
 need(rows.every(row=>row&&Object.keys(row).sort().join(',')==='evidence,observed_at'&&row.evidence&&typeof row.evidence==='object'&&!Array.isArray(row.evidence)),'ROW_SHAPE_MISMATCH');
 const received=rows.map(row=>row.evidence.id).sort();
 need(new Set(received).size===ids.length&&received.every((id,index)=>id===ids[index]),'ROW_MEMBERSHIP_MISMATCH');
 const observedAt=rows[0].observed_at;
 need(rows.every(row=>row.observed_at===observedAt),'MIXED_OBSERVATION_TIMES');
 need(timestamp(observedAt)===timestamp(e.original_observed_at_min),'ORIGINAL_TIME_MISMATCH');
 return {format:FORMAT,rowCount:rows.length,uniqueMembers:received.length,observedAt,rawBytes:plaintext.length,encryptedBytes:e.encrypted_bytes,plaintextSha256:e.plaintext_sha256,membershipSha256:e.membership_sha256,querySha256:e.query_sha256,observationAppended:false};
}

export function decryptEnvelope(baseline,input,key){
 validKey(key);const {envelope:e,ciphertext}=validateEnvelope(baseline,input),home=mkdtempSync(join(tmpdir(),'icash-cohort-gpg-'));
 try{
  const cipherPath=join(home,'observation.pgp');writeFileSync(cipherPath,ciphertext,{mode:0o600,flag:'wx'});
  const result=spawnSync('gpg',['--no-options','--homedir',home,'--batch','--no-tty','--no-autostart','--pinentry-mode','loopback','--no-symkey-cache','--no-auto-key-retrieve','--max-output',String(e.raw_bytes),'--passphrase-fd','0','--decrypt',cipherPath],{input:key+'\n',timeout:15000,killSignal:'SIGKILL',maxBuffer:e.raw_bytes+65536});
  need(!result.error&&result.status===0,'GPG_DECRYPTION_FAILED');
  const receipt=verifyPlaintext(baseline,e,result.stdout);return {plaintext:result.stdout,receipt};
 }finally{rmSync(home,{recursive:true,force:true});}
}

const checkedPath=path=>{need(typeof path==='string'&&isAbsolute(path)&&path.length<=4096,'ABSOLUTE_PRIVATE_PATH_REQUIRED');return resolve(path);};
const privateRead=(path,limit)=>{
 path=checkedPath(path);need(realpathSync(path)===path,'SYMLINK_PATH_REFUSED');
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const st=fstatSync(fd);need(st.isFile()&&(st.mode&0o077)===0&&st.size>0&&st.size<=limit,'PRIVATE_FILE_BOUND');
  const bytes=Buffer.alloc(st.size+1);let n=0,read;
  while(n<bytes.length&&(read=readSync(fd,bytes,n,bytes.length-n,null))>0)n+=read;
  need(n===st.size,'INPUT_FILE_CHANGED');return bytes.subarray(0,n);
 }finally{closeSync(fd);}
};
const outputPath=path=>{
 path=checkedPath(path);const parent=dirname(path);
 need(realpathSync(parent)===parent&&statSync(parent).isDirectory()&&(statSync(parent).mode&0o077)===0,'PRIVATE_OUTPUT_DIRECTORY_REQUIRED');return path;
};
const writeNew=(path,bytes)=>writeFileSync(outputPath(path),bytes,{flag:'wx',mode:0o600});
const keyFrom=path=>{const bytes=privateRead(path,65),key=bytes.toString('utf8').replace(/\n$/,'');validKey(key);return key;};

export function transportCli(args){
 const [command,...paths]=args;
 if(command==='key'&&paths.length===1){writeNew(paths[0],randomBytes(32).toString('hex')+'\n');return {keyCreated:true};}
 if(command==='sql'&&paths.length===3){
  const [baselinePath,keyPath,sqlPath]=paths,baselineBytes=privateRead(baselinePath,MAX_RAW_BYTES),key=keyFrom(keyPath);
  const manifest=createTransportManifest(baselineBytes,key),sql=renderTransportQuery(json(baselineBytes),key),manifestPath=outputPath(sqlPath+'.manifest.json');
  let written=false;
  try{writeNew(sqlPath,sql);written=true;writeNew(manifestPath,JSON.stringify(manifest,null,2)+'\n');}
  catch(error){if(written)unlinkSync(sqlPath);throw error;}
  return {sqlCreated:true,...manifest};
 }
 if(command==='decode'&&paths.length===5){
  const [baselinePath,keyPath,sqlPath,envelopePath,rowsPath]=paths,baselineBytes=privateRead(baselinePath,MAX_RAW_BYTES),key=keyFrom(keyPath);
  const baseline=verifyTransportSources(baselineBytes,key,privateRead(sqlPath,MAX_RAW_BYTES),json(privateRead(sqlPath+'.manifest.json',4096)));
  const envelope=json(privateRead(envelopePath,MAX_ENVELOPE_BYTES));outputPath(rowsPath);
  const {plaintext,receipt}=decryptEnvelope(baseline,envelope,key);writeNew(rowsPath,plaintext);return receipt;
 }
 throw new TransportError('USE_KEY_OR_SQL_OR_DECODE_WITH_PRIVATE_ABSOLUTE_PATHS');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{process.stdout.write(JSON.stringify(transportCli(process.argv.slice(2)))+'\n');}
 catch(error){process.stderr.write((error instanceof TransportError?error.message:'COHORT_TRANSPORT_FAILED')+'\n');process.exitCode=1;}
}
