// Local SQL only. No production data, providers, messages or billing.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const pg=new PGlite(),q=(sql,args=[])=>pg.query(sql,args),uuid=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const account=uuid(1),other=uuid(2),sql=readFileSync(new URL('../config/workspace-ready-opportunities.sql',import.meta.url),'utf8');
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role;
 create table icash_screening_jobs(id uuid primary key,account_id uuid,state text,result jsonb,snapshot jsonb,completed_at timestamptz,created_at timestamptz);
 create table icash_opportunity_outcomes(screening_id uuid primary key,account_id uuid,responded boolean default false,purchase_signed boolean default false,interested boolean default false,opted_out boolean default false,response_at timestamptz);`);
 await pg.exec(sql);
 async function property(n,{acct=account,status='eligible',state='complete',fetchedAt=new Date().toISOString(),age=0,type='house',practice=false,responded=false,signed=false,optedOut=false}={}){
  await q("insert into icash_screening_jobs values($1,$2,$3,$4,$5,now()-make_interval(hours=>$6),now()-make_interval(mins=>$7))",[uuid(n),acct,state,{property:{propertyId:'prop_'+n,address:n+' Sample Street'},financialCheck:{status}},{propertyId:'prop_'+n,propertyType:type,fetchedAt,practice},age,n]);
  await q('insert into icash_opportunity_outcomes(screening_id,account_id,responded,purchase_signed,opted_out,response_at) values($1,$2,$3,$4,$5,case when $3 then now() end)',[uuid(n),acct,responded,signed,optedOut]);
 }
 // Many recent held rows must not hide later eligible rows through pagination.
 for(let n=10;n<30;n++)await property(n,{status:'hold'});
 await property(30);await property(31);await property(32,{status:'hold',age:48,responded:true});await property(33,{status:'hold',age:48,signed:true});
 await property(34,{age:25});await property(35,{fetchedAt:'invalid'});await property(36,{fetchedAt:new Date(Date.now()-25*3600000).toISOString()});
 await property(37,{fetchedAt:new Date(Date.now()+3600000).toISOString()});await property(38,{type:'land'});await property(39,{practice:true,responded:true});await property(40,{optedOut:true});await property(41,{state:'queued'});await property(42,{acct:other});
 const read=async(offset=0,limit=7,query='')=>(await q('select * from icash_workspace_ready_opportunities($1,$2,$3,$4)',[account,query,offset,limit])).rows;
 assert.deepEqual((await read()).map(r=>r.id),[uuid(33),uuid(32),uuid(30),uuid(31)],'real responses and signed work rank first; only fresh eligible single-family research follows');
 assert.deepEqual((await read(2,1)).map(r=>r.id),[uuid(30)],'filtering happens before pagination');
 assert.deepEqual((await read(3,1)).map(r=>r.id),[uuid(31)]);
 assert.deepEqual((await read(0,7,'31 Sample')).map(r=>r.id),[uuid(31)],'literal address search retained');
 assert.equal((await read()).find(r=>r.id===uuid(30)).engagement.responded,false,'eligibility does not invent a seller reply');
 assert.equal((await read()).find(r=>r.id===uuid(32)).result.financialCheck.status,'hold','actual response retains honest financial status');
 assert.equal((await q('select count(*)::int n from icash_screening_jobs')).rows[0].n,33,'read-only view keeps held/history rows');
 for(const role of ['anon','authenticated'])assert.equal((await q("select has_function_privilege($1,'icash_workspace_ready_opportunities(uuid,text,integer,integer)','EXECUTE') allowed",[role])).rows[0].allowed,false);
 const migration=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(n=>n.endsWith('_workspace_ready_opportunities.sql'));assert.equal(migration.length,1);assert.equal(readFileSync(new URL('../supabase/migrations/'+migration[0],import.meta.url),'utf8'),sql);
 console.log('Ready opportunities: eligible/fresh single-family or actual response/signature, tenant isolation, response-first ordering before pagination, historical rows and private access passed.');
}finally{await pg.close();}
