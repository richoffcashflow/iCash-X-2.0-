import {readFileSync} from 'node:fs';
import {installReservePrerequisites} from '../../scripts/test-new-user-request-reserve-pglite.mjs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');

export async function installHeadroomFixture(pg){
 await installReservePrerequisites(pg);
 await pg.exec(read('config/new-user-request-reserve.sql'));
 await pg.exec(read('tests/fixtures/new-user-request-reserve-exclusions-foundation.sql'));
 await pg.exec(`alter table icash_research_private.settings add column exclusion_sync_enabled boolean default false;
 create table icash_research_private.financial_settings(id int primary key,enabled boolean);
 insert into icash_research_private.financial_settings values(1,true);
 create table icash_research_private.request_reserve_exclusion_claims(token uuid primary key,account_id uuid,list_id text,created_at timestamptz default clock_timestamp());`);
 for(const f of JSON.parse(read('tests/fixtures/request-budget-pacing-before.json')))await pg.exec(f.definition);
 await pg.exec(read('config/research-request-pacing.sql'));
 // These exact production selector bodies are compiled, not executed by this
 // bounded quota fixture. Their only changed calls are checked independently.
 await pg.exec(`create table public.icash_automation_tickets(id uuid,account_id uuid,kind text,screening_id uuid,voice_job_id uuid,opener_message_id uuid,token text);`);
 for(const f of JSON.parse(read('tests/fixtures/acquisition-headroom-schedulers.json')))await pg.exec(f.definition);
 await pg.exec(`update icash_research_private.request_reserve_policy set enabled=true;
 update icash_research_private.request_pacing_policy set enabled=true,activate_after=now()-interval '2 days';`);
}

// Deterministic continuous demand using the actual production capacity/pacing
// functions. Time/counters and jobs here belong only to the disposable fixture.
// Mirror the acquisition selector: two-request candidate filter, oldest due
// account first, then the existing three-request export check. A skipped contact
// advances its schedule, as the real acquisition loop does after finding no job.
export async function mixedDemand(pg,account,schedulerHeadroom=false){
 const q=(s,a=[])=>pg.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0])[0];
 const jobs=[{kind:'contacts',due:-600,needs:3,done:0},{kind:'discovery',due:0,needs:2,done:0}];
 let spent=0;
 await pg.exec('begin');
 try{
  for(let tick=0;tick<=600;tick++){
   await q("update public.icash_dealmachine_request_budget set day_start=now()-interval '12 hours'-make_interval(secs=>$1),day_used=4671+$2,minute_start=now(),minute_used=0",[tick,spent]);
   if(!await v(schedulerHeadroom?'select public.icash_acquisition_capacity_available($1)':'select public.icash_dealmachine_capacity_available(2,$1)',[account]))continue;
   for(const job of [...jobs].sort((a,b)=>a.due-b.due)){
    if(job.due>tick)continue;
    if(!await v('select public.icash_dealmachine_capacity_available($1,$2)',[job.needs,account])){job.due=tick+60;continue;}
    spent+=job.needs;job.done++;job.due=tick+1;break;
   }
  }
  return {contacts:jobs[0].done,discovery:jobs[1].done,spent};
 }finally{await pg.exec('rollback');}
}
