import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';
import {uploadWebinarFile} from '../lib/webinar-upload.ts';
const deps={randomUUID:()=> 'upload-id',z,webinarOrigin(){},webinarOwner:async()=>({id:'owner'}),webinarLimit:async()=>{},webinarBody:r=>r.json(),webinarHeaders:{},webinarError:e=>{throw e;},WebinarError:Error};
globalThis.uploadRouteDeps=deps;
const code=ts.transpileModule(readFileSync(new URL('../app/api/webinar/studio/upload/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .*;\s*$/gm,'');
const {POST}=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.uploadRouteDeps;\n'+code).toString('base64'));
const originalFetch=globalThis.fetch,base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;
try{
 process.env.SUPABASE_URL='https://upload-test.supabase.co';process.env.SUPABASE_SECRET_KEY='server-only-test-key';
 let initialized=false;
 globalThis.fetch=async(url,init)=>{
  if(String(url).includes('/object/upload/sign/'))return Response.json({url:'/object/upload/sign/icash-webinars/owner/upload-id.mp4?token=test.signed.token'});
  assert.equal(url,'https://upload-test.storage.supabase.co/storage/v1/upload/resumable/sign');
  assert.equal(init.headers['x-signature'],'test.signed.token');assert.equal(init.headers['Upload-Length'],'259737057');initialized=true;
  return new Response(null,{status:201,headers:{Location:url+'/upload-id'}});
 };
 const response=await POST(new Request('https://app.test/api/webinar/studio/upload',{method:'POST',body:JSON.stringify({type:'video/mp4',size:259737057})}));
 const config=await response.json();assert.equal(config.endpoint,'https://upload-test.storage.supabase.co/storage/v1/upload/resumable/sign');assert.equal(config.token,'test.signed.token');assert.ok(!JSON.stringify(config).includes('server-only-test-key'));
 const file=new File([new Uint8Array(7*1024*1024)],'webinar.mp4',{type:'video/mp4'});let offset=0;assert.ok(initialized);assert.ok(config.uploadUrl);
 globalThis.fetch=async(url,init)=>{
  if(url==='/api/webinar/studio/upload')return Response.json(config);
  assert.equal(init.headers['x-signature'],config.token);
  assert.notEqual(init.method,'POST','Browser does not initialize storage uploads');assert.equal(String(url),config.endpoint+'/upload-id');assert.equal(init.method,'PATCH');assert.equal(Number(init.headers['Upload-Offset']),offset);offset+=init.body.size;return new Response(null,{status:204,headers:{'Upload-Offset':String(offset)}});
 };
 const progress=[];assert.equal(await uploadWebinarFile(file,n=>progress.push(n)),config.publicUrl);assert.equal(offset,file.size);assert.equal(progress.at(-1),100);
 const savedUploadUrl=config.uploadUrl;config.uploadUrl='https://untrusted.invalid/upload';await assert.rejects(uploadWebinarFile(file,()=>{}),/Unexpected upload destination/);config.uploadUrl=savedUploadUrl;
 console.log('PASS signed upload endpoint, server-only key isolation, MP4 initiation and multi-chunk completion.');
}finally{globalThis.fetch=originalFetch;if(base===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=base;if(key===undefined)delete process.env.SUPABASE_SECRET_KEY;else process.env.SUPABASE_SECRET_KEY=key;}
