// Export the SAME current-function fixture used by PGlite to native PostgreSQL.
// No database/network connection and no separate hand-maintained SQL fixture.
import {setupOwnerDemoRestartFixture} from '../tests/helpers/owner-demo-restart-fixture.mjs';
const statements=[];
const literal=v=>v===null?'NULL':typeof v==='boolean'?String(v):typeof v==='number'?String(v):"'"+String(typeof v==='object'?JSON.stringify(v):v).replaceAll("'","''")+"'";
const pg={
 async exec(sql){statements.push(sql+'\n;');},
 async query(sql,args=[]){
  statements.push(sql.replace(/\$(\d+)/g,(_,n)=>{if(Number(n)>args.length)throw new Error('Missing fixture parameter');return literal(args[Number(n)-1]);})+';');
  // Setup must never silently depend on SELECT results from this recorder.
  return new Proxy({}, {get(_,key){if(key==='then')return undefined;throw new Error('Fixture setup needs query results; use a real adapter');}});
 }
};
await setupOwnerDemoRestartFixture({pg,account:'48dfb798-8c1a-404f-88c0-c396cc067062',owner:'592171a0-2bb9-484e-8c9a-dd5d2b43b5f7',other:'00000000-0000-4000-8000-000000000002',phone:'+12142185280',sender:'+17208134296',distinct:false});
// Roles persist between reliability suites; their privileges are recreated here.
console.log(statements.join('\n').replace(/create role (anon|authenticated|service_role);/g,(_,r)=>`do $$begin if not exists(select 1 from pg_roles where rolname='${r}') then create role ${r};end if;end$$;`));
