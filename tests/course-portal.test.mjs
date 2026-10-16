import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
import {z,ZodError} from 'zod';
import {PGlite} from '@electric-sql/pglite';
import {courseBucket,courseUploadInput,issueCourseTicket,readCourseTicket} from '../lib/course-policy.ts';
const ownerId='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7',key='course-test-key-never-used-in-production';
const spec={kind:'pdf',type:'application/pdf',size:100,name:'Course.pdf',revision:0};
for(const bad of [{...spec,type:'text/html'},{...spec,size:52428801},{...spec,kind:'video'},{...spec,revision:-1},{...spec,path:'../other'},{...spec,size:0}])assert.equal(courseUploadInput.safeParse(bad).success,false);
assert(courseUploadInput.safeParse({...spec,kind:'video',type:'video/mp4',size:2147483648}).success);
const info={...spec,owner:ownerId,path:ownerId+'/'+randomUUID()+'.pdf',expires:Math.floor(Date.now()/1000)+7200},ticket=issueCourseTicket(info,key);
assert.deepEqual(readCourseTicket(ticket,ownerId,key),info);
for(const [t,o,k,n] of [[ticket+'x',ownerId,key],[ticket,randomUUID(),key],[ticket,ownerId,key+'changed'],[ticket,ownerId,key,Date.now()+7201000]])assert.throws(()=>readCourseTicket(t,o,k,n));
let serial=0;
async function load(file,deps){const name='__courseTest'+serial++;globalThis[name]=deps;const source=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');return import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.'+name+';\n'+source).toString('base64'));}
let user=null,proof=false,accessError=null,reads=0,fetches=[],saved=[],assets=[{kind:'pdf',path:null,name:null,size:null,mime_type:null,revision:0},{kind:'video',path:null,name:null,size:null,mime_type:null,revision:0}];
const server=await load('lib/course-server.ts',{ZodError,courseBucket,currentUser:async()=>user,requireDashboardPassword:async()=>{if(!proof)throw Error('DASHBOARD_PASSWORD_REQUIRED');},ownerInboundTarget:{ownerUserId:ownerId},workAccount:async options=>{assert.deepEqual(options,{allowUnacknowledged:true});if(accessError)throw Error(accessError);return {accountId:'account',userId:user?.id};},db:async()=>assets});
await assert.rejects(server.courseOwner(),/SIGN_IN_REQUIRED/);user={id:randomUUID()};await assert.rejects(server.courseOwner(),/Only the platform owner/);user={id:ownerId};await assert.rejects(server.courseOwner(),/DASHBOARD_PASSWORD_REQUIRED/);proof=true;assert.equal((await server.courseOwner()).id,ownerId);await server.courseAccess();
const deps={...server,z,randomUUID,courseBucket,courseUploadInput,issueCourseTicket,readCourseTicket,ownerInboundTarget:{ownerUserId:ownerId},requireDashboardPassword:async()=>{if(!proof)throw Error('DASHBOARD_PASSWORD_REQUIRED');},courseStorage:()=>({base:'https://fixture.supabase.co',key,headers:{apikey:key,Authorization:'Bearer '+key}}),webinarOrigin:req=>{if(req.headers.get('origin')!=='https://www.geticashx.com')throw new server.CourseError(403,'Invalid origin');},webinarBody:req=>req.json(),webinarLimit:async()=>{},WebinarError:class extends Error{},courseAssets:async()=>{reads++;return assets;},db:async(path,method,body)=>{if(path.includes('vip_access'))return {vip:false,vipFeatures:false};saved.push({path,method,body});assets=assets.map(a=>a.kind===body.mime_type.replace('application/','')?{...a,...body}:a);return [body];}};
const overview=await load('app/api/course/route.ts',deps),download=await load('app/api/course/assets/[kind]/route.ts',{...deps,courseAssetUrl:async a=>'https://fixture.supabase.co/signed/'+a.kind});
accessError='SIGN_IN_REQUIRED';assert.equal((await overview.GET()).status,401);assert.equal(reads,0);assert.equal((await download.GET(null,{params:Promise.resolve({kind:'video'})})).status,401);assert.equal(reads,0);
accessError='SUBSCRIPTION_REQUIRED';assert.equal((await overview.GET()).status,403);accessError=null;proof=false;
assert.equal((await (await overview.GET()).json()).canUpload,false);proof=true;assert.equal((await (await overview.GET()).json()).canUpload,true);
const upload=await load('app/api/course/upload/route.ts',deps),request=(body,origin='https://www.geticashx.com')=>new Request(origin+'/api/course/upload',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
const originalFetch=globalThis.fetch;
const previousEnv={SUPABASE_URL:process.env.SUPABASE_URL,SUPABASE_SECRET_KEY:process.env.SUPABASE_SECRET_KEY};
try{
 process.env.SUPABASE_URL='https://fixture.supabase.co';process.env.SUPABASE_SECRET_KEY=key;
 globalThis.fetch=async()=>Response.json({signedURL:`/object/sign/${courseBucket}/${info.path}?token=fixture`});
 const pdfUrl=new URL(await server.courseAssetUrl({...info,kind:'pdf'}));assert.equal(pdfUrl.pathname,`/storage/v1/object/sign/${courseBucket}/${info.path}`);assert.equal(pdfUrl.searchParams.get('download'),'iCash-X-Course-Guide.pdf');
 const videoUrl=new URL(await server.courseAssetUrl({...info,kind:'video'}));assert.equal(videoUrl.searchParams.has('download'),false);
 globalThis.fetch=async()=>Response.json({signedURL:'https://evil.invalid/file'});await assert.rejects(server.courseAssetUrl(info),/Invalid file destination/);
}finally{globalThis.fetch=originalFetch;for(const [k,v] of Object.entries(previousEnv)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
try{
 globalThis.fetch=async(url,options)=>{fetches.push({url,options});if(options.method==='HEAD')return new Response(null,{headers:{'content-type':'application/pdf','content-length':'100'}});if(url.includes('/object/upload/sign/'))return Response.json({url:'/object/upload/sign/'+courseBucket+'/'+info.path+'?token=scoped-signature'});if(url.includes('/upload/resumable/sign'))return new Response(null,{status:201,headers:{Location:'https://fixture.storage.supabase.co/storage/v1/upload/resumable/sign/session'}});throw Error('Unexpected provider request');};
 user={id:randomUUID()};assert.equal((await upload.POST(request(spec))).status,403);assert.equal(fetches.length,0);user={id:ownerId};proof=false;assert.equal((await upload.POST(request(spec))).status,403);assert.equal(fetches.length,0);proof=true;
 assert.equal((await upload.POST(request(spec,'https://evil.invalid'))).status,403);assert.equal(fetches.length,0);
 assert.equal((await upload.POST(request({...spec,type:'text/html'}))).status,400);assert.equal(fetches.length,0);
 const prepared=await upload.POST(request(spec));assert.equal(prepared.status,200);const config=await prepared.json();assert(config.ticket);assert(!JSON.stringify(config).includes(key));assert.equal(fetches[1].options.headers['Upload-Length'],'100');assert(fetches[1].options.headers['Upload-Metadata'].includes('bucketName '+Buffer.from(courseBucket).toString('base64')));
 const published=await upload.POST(request({ticket:config.ticket}));assert.equal(published.status,200);assert.equal(saved.length,1);assert(saved[0].path.endsWith('revision=eq.0'));assert.equal(saved[0].body.revision,1);
 assert.equal((await upload.POST(request({ticket:config.ticket}))).status,200);assert.equal(saved.length,1,'Lost publish responses can be retried without overwriting or incrementing twice');
 const conflict=issueCourseTicket({...info,path:ownerId+'/'+randomUUID()+'.pdf'},key);assert.equal((await upload.POST(request({ticket:conflict}))).status,409);assert.equal(saved.length,1);
 assets[0]={...assets[0],revision:0,path:null};globalThis.fetch=async()=>new Response(null,{status:404});assert.equal((await upload.POST(request({ticket}))).status,409);assert.equal(saved.length,1,'Incomplete upload never replaces the course');
}finally{globalThis.fetch=originalFetch;}
const pg=new PGlite();try{
 await pg.exec('create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key); create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);');
 await pg.exec(readFileSync(new URL('../supabase/migrations/20261016070000_client_course_portal.sql',import.meta.url),'utf8'));
 assert.equal((await pg.query("select public from storage.buckets where id='icash-course'")).rows[0].public,false);
 const rights=(await pg.query("select has_table_privilege('anon','icash_course_assets','select') anon,has_table_privilege('authenticated','icash_course_assets','update') customer,relrowsecurity rls from pg_class where oid='icash_course_assets'::regclass")).rows[0];assert.deepEqual(rights,{anon:false,customer:false,rls:true});
 await assert.rejects(pg.exec("update icash_course_assets set path='bad',name='bad' where kind='video'"));
}finally{await pg.close();}
console.log('PASS course portal: membership access, owner proof, origin/type/size validation, scoped uploads, complete-file publishing, stale-write and retry safety, and private storage grants.');
