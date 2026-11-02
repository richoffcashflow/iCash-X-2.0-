import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import ts from 'typescript';
import {z} from 'zod';
import {renderDealDocument,dealTermsSchema} from '../lib/deal-documents.ts';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const migration=readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(name=>name.endsWith('_contract_document_storage.sql'));
assert.equal(read('supabase/migrations/'+migration),read('config/contract-document-storage.sql'));
const sql=new PGlite(),account='00000000-0000-4000-8000-000000000001',deal='00000000-0000-4000-8000-000000000002';
const terms=dealTermsSchema.parse({seller:'Synthetic Seller <script>',buyer:'Fixture LLC',address:'123 Fixture Lane',priceCents:12000000});
let activeAccount=account,origin=true;
try{
 await sql.exec('create table public.icash_deal_files(id uuid primary key,account_id uuid,terms jsonb);');
 const original=read('supabase/migrations/20260928223811_deal_documents_and_showings.sql').match(/create table public\.icash_deal_documents \([\s\S]*?\n\);/)[0];
 await sql.exec(original);
 await sql.query('insert into icash_deal_files values($1,$2,$3)',[deal,account,JSON.stringify(terms)]);
 for(const kind of ['purchase','assignment']){
  const html=renderDealDocument(kind,terms);assert(Buffer.byteLength(html)>100000);
  await assert.rejects(sql.query('insert into icash_deal_documents(deal_id,kind,terms,html) values($1,$2,$3,$4)',[deal,kind,JSON.stringify(terms),html]),error=>error.code==='23514','Original schema rejects the approved forms');
 }
 await sql.exec(read('supabase/migrations/'+migration));
 const deps={NextResponse:{json:Response.json},workAccount:async()=>({accountId:activeAccount}),allowedOrigin:()=>origin,renderDealDocument,z,
  db:async(path,method,body)=>{
   if(path==='icash_deal_documents'&&method==='POST')return (await sql.query('insert into icash_deal_documents(deal_id,kind,terms,html) values($1,$2,$3,$4) returning id',[body.deal_id,body.kind,JSON.stringify(body.terms),body.html])).rows;
   const [table,params]=path.split('?'),filters=new URLSearchParams(params),columns=filters.get('select');
   assert(['icash_deal_documents','icash_deal_files'].includes(table));assert(['terms','deal_id','id','html,kind'].includes(columns));
   const args=[],where=[];
   for(const [key,val] of filters){if(key==='select')continue;assert(['id','deal_id','account_id'].includes(key));assert(val.startsWith('eq.'));args.push(val.slice(3));where.push(`${key}=$${args.length}`);}
   return (await sql.query(`select ${columns} from ${table} where ${where.join(' and ')}`,args)).rows;
  }};
 globalThis.__documentStorage=deps;
 const source=ts.transpileModule(read('app/api/work/documents/route.ts'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
 const {POST,GET}=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.__documentStorage;\n'+source).toString('base64'));
 delete globalThis.__documentStorage;
 const request=kind=>new Request('https://example.invalid/api/work/documents',{method:'POST',body:JSON.stringify({dealId:deal,kind})});
 for(const kind of ['purchase','assignment','buyer_package','title_packet']){
  const response=await POST(request(kind));assert.equal(response.status,200,kind+' saves through the actual route');
  const saved=await response.json();assert.equal(saved.html,renderDealDocument(kind,terms));
  const reopened=await GET(new Request('https://example.invalid/api/work/documents?id='+saved.id));assert.equal(reopened.status,200);
  assert.equal((await reopened.json()).html,saved.html,'Reopening preserves the exact rendered form');
  activeAccount='00000000-0000-4000-8000-000000000099';
  assert.equal((await GET(new Request('https://example.invalid/api/work/documents?id='+saved.id))).status,404);
  assert.equal((await POST(request(kind))).status,400);activeAccount=account;
 }
 origin=false;assert.equal((await POST(request('purchase'))).status,403);
 for(const [kind,limit] of [['purchase',1048576],['assignment',1048576],['buyer_package',100000],['title_packet',100000]]){
  await assert.rejects(sql.query('insert into icash_deal_documents(deal_id,kind,terms,html) values($1,$2,$3,$4)',[deal,kind,'{}','x'.repeat(limit)]),error=>error.code==='23514','The byte cap remains enforced');
 }
 console.log('Documents: reproduced both original size failures; actual save/reopen routes pass for all four kinds, with tenant/origin checks and bounded storage.');
}finally{await sql.close();}
