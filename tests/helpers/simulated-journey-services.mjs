// SIMULATION ONLY. Services retain their actual bodies; imports are wired to actual
// policy modules, this isolated PostgreSQL adapter, and explicit provider fixtures.
import assert from 'node:assert/strict';
import ts from 'typescript';
import {read} from './simulated-journey-db.mjs';
const identifier=x=>{assert(/^[a-z_][a-z_0-9]*$/i.test(x),`Unsafe fixture identifier: ${x}`);return '"'+x+'"';};
const value=x=>x!==null&&typeof x==='object'?JSON.stringify(x):x;
export function databaseAdapter(pg){
 const calls=[],functions=new Map(),booleanColumns=new Map();
 const q=(sql,args=[])=>pg.query(sql,args.map(value));
 const rpc=async(name,args={})=>{
  identifier(name);calls.push({rpc:name,args});
  let sig=functions.get(name);
  if(!sig){sig=(await q(`select proretset as retset,coalesce('t'=any(proargmodes),false) as table_result,proargnames as names,array(select format_type(x,null) from unnest(proargtypes::oid[]) x) as types from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname=$1`,[name])).rows;
   assert.equal(sig.length,1,`RPC ${name} must have one real signature`);sig=sig[0];functions.set(name,sig);}
  const keys=Object.keys(args),params=keys.map((key,i)=>{const index=sig.names.indexOf(key);assert(index>=0,`Unknown argument ${name}.${key}`);return identifier(key)+'=> $'+(i+1)+'::'+sig.types[index];});
  const call=`public.${identifier(name)}(${params.join(',')})`;
  // PostgREST keeps RETURNS TABLE rows as objects even for a single column.
  const output=sig.table_result?sig.names.slice(sig.types.length).map(key=>`'${identifier(key).slice(1,-1)}', row.${identifier(key)}`).join(','):null;
  const rows=(await q(sig.table_result?`select jsonb_build_object(${output}) as result from ${call} row`:`select to_jsonb(${call}) as result`,keys.map(k=>args[k]))).rows;return sig.retset?rows.map(r=>r.result):rows[0].result;
 };
 const db=async(path,method='GET',body)=>{
  if(path.startsWith('rpc/')){assert.equal(method,'POST');return rpc(path.slice(4),body);}
  const [table,search='']=path.split('?');identifier(table);calls.push({table,path,method});
  if(!booleanColumns.has(table))booleanColumns.set(table,new Set((await q("select attname from pg_attribute where attrelid=to_regclass('public.'||$1) and atttypid='boolean'::regtype and not attisdropped",[table])).rows.map(r=>r.attname)));
  const filterValue=(key,val)=>booleanColumns.get(table).has(key)&&['true','false'].includes(val)?val==='true':val;
  const params=new URLSearchParams(search),args=[],where=[],order=[];let limit='';
  for(const [key,expression] of params){
   if(key==='select')continue;
   if(key==='limit'){assert(/^\d+$/.test(expression));limit=' limit '+expression;continue;}
   if(key==='order'){for(const item of expression.split(',')){const [col,direction='asc']=item.split('.');assert(['asc','desc'].includes(direction));order.push(identifier(col)+' '+direction);}continue;}
   const dot=expression.indexOf('.'),op=expression.slice(0,dot),val=expression.slice(dot+1),col=identifier(key);
   if(op==='like'){args.push(val.replaceAll('*','%'));where.push(col+' like $'+args.length);}
   else if(op==='cs'){assert(/^\{[A-Za-z0-9_, -]*\}$/.test(val));args.push(val);where.push(col+' @> $'+args.length+'::text[]');}
   else if(op==='is'){assert.equal(val,'null');where.push(col+' is null');}
   else if(op==='in'){assert(/^\([^()]*\)$/.test(val));const values=val.slice(1,-1).split(',');where.push(col+' in ('+values.map(x=>{args.push(filterValue(key,x));return '$'+args.length;}).join(',')+')');}
   else{assert(['eq','gt','gte','lt','lte','neq'].includes(op),`Unsupported fixture filter ${expression}`);args.push(filterValue(key,val));where.push(col+({eq:'=',gt:'>',gte:'>=',lt:'<',lte:'<=',neq:'<>'}[op])+'$'+args.length);}
  }
  const condition=where.length?' where '+where.join(' and '):'';
  if(method==='GET')return (await q('select to_jsonb(t) as row from public.'+identifier(table)+' t'+condition+(order.length?' order by '+order.join(','):'')+limit,args)).rows.map(r=>r.row);
  if(method==='PATCH'){assert(where.length,'Fixture mutations require a filter');const assignments=Object.entries(body).map(([k,v])=>{args.push(v);return identifier(k)+'=$'+args.length;});return (await q('update public.'+identifier(table)+' set '+assignments.join(',')+condition+' returning *',args)).rows;}
  if(method==='POST'){assert(!search);const keys=Object.keys(body);return (await q('insert into public.'+identifier(table)+'('+keys.map(identifier).join(',')+') values('+keys.map((_,i)=>'$'+(i+1)).join(',')+') returning *',Object.values(body))).rows;}
  throw Error('Unsupported fixture method '+method);
 };
 return {db,rpc,q,calls};
}
let seq=0;
// The original journey schema predates request diagnostics and query-policy
// rollout. Preserve its real limiter/admission while modeling those new, inert
// metadata calls explicitly. research-efficiency-database exercises the new SQL.
export function legacyResearchFixtureDb(db){
 return (path,method,body)=>{
  if(path==='rpc/icash_claim_discovery_estimate')return Promise.resolve({status:'request',token:'00000000-0000-4000-8000-000000000001'});
  if(path==='rpc/icash_finish_discovery_estimate')return Promise.resolve(true);
  if(path==='rpc/icash_prepare_research_efficiency')return Promise.resolve(false);
  if(path==='rpc/icash_claim_research_exclusions')return Promise.resolve(null);
  if(path==='rpc/icash_finish_dealmachine_request')return Promise.resolve(true);
  return db(path,method,path==='rpc/icash_take_dealmachine_request'?{}:body);
 };
}
export async function loadService(file,deps){
 const key='__isolatedJourney'+seq++;globalThis[key]=deps;
 let code=ts.transpileModule(read(file),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 code=code.replace(/^import .* from .*;$/gm,'');assert(!/^import /m.test(code),`Unresolved import in ${file}`);
 try{return await import('data:text/javascript;base64,'+Buffer.from(`const {${Object.keys(deps).join(',')}}=globalThis.${key};\n`+code).toString('base64'));}
 finally{delete globalThis[key];}
}
