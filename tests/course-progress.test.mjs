import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {databaseAdapter,loadService} from './helpers/simulated-journey-services.mjs';
import {coursePlaybackSnapshot,courseProgressInput,courseProgressEvidence} from '../lib/course-progress.ts';
import {supportConversationFallback} from '../lib/support-conversation.ts';
const played=ranges=>({length:ranges.length,start:i=>ranges[i][0],end:i=>ranges[i][1]});
assert.equal(coursePlaybackSnapshot({duration:100,played:played([]),currentTime:100},1),null,'Opening/seeking to the end does not count as watching');
assert.deepEqual(coursePlaybackSnapshot({duration:100,played:played([[0,10],[90,95]])},1),{revision:1,durationMs:100000,ranges:[[0,10000],[90000,95000]]});
for(const bad of [{revision:1,durationMs:100,ranges:[[0,101]]},{revision:1,durationMs:100,ranges:[[50,10]]},{revision:1,durationMs:100,ranges:[[0,10]],accountId:randomUUID()},{revision:1,durationMs:Infinity,ranges:[[0,10]]}])assert.equal(courseProgressInput.safeParse(bad).success,false);
const pg=await PGlite.create(),{rpc,q,db}=databaseAdapter(pg),account=randomUUID(),user=randomUUID(),other=randomUUID();
try{
 await pg.exec('create role anon;create role authenticated;create role service_role bypassrls;create table icash_accounts(id uuid primary key,owner_user_id uuid);create table icash_course_assets(kind text primary key,path text,revision integer);grant usage on schema public to service_role;grant all on all tables in schema public to service_role;');
 await pg.exec(readFileSync(new URL('../supabase/migrations/20261017233326_course_viewing_progress.sql',import.meta.url),'utf8'));
 await q('insert into icash_accounts values($1,$2)',[account,user]);await q("insert into icash_course_assets values('video','private-course.mp4',1)");
 await pg.exec('set role service_role');
 assert.equal((await rpc('icash_read_course_progress',{p_account:account})).state,'unrecorded');
 const input={p_account:account,p_user:user,p_revision:1,p_duration:100000,p_ranges:[[0,10000],[90000,95000]]};
 await assert.rejects(()=>rpc('icash_record_course_progress',{...input,p_user:other}));
 let result=await rpc('icash_record_course_progress',input);assert.equal(result.percent,15);assert.equal(result.state,'in_progress');
 assert.equal((await rpc('icash_record_course_progress',input)).percent,15,'Duplicate heartbeat cannot double counted time');
 result=await rpc('icash_record_course_progress',{...input,p_ranges:[[5000,30000]]});assert.equal(result.percent,35,'Overlapping ranges are unioned across devices');
 result=await rpc('icash_record_course_progress',{...input,p_ranges:[[0,90000]]});assert.equal(result.percent,95);assert.equal(result.state,'completed');
 assert.equal((await rpc('icash_read_course_progress',{p_account:other})).state,'unrecorded');
 await assert.rejects(()=>rpc('icash_record_course_progress',{...input,p_ranges:[[0,100001]]}));
 await q("update icash_course_assets set revision=2 where kind='video'");
 assert.equal((await rpc('icash_read_course_progress',{p_account:account})).state,'unrecorded','A replacement video does not inherit old viewing');
 assert.equal(await rpc('icash_record_course_progress',input),null,'Stale video cannot update current progress');
 let allowed=true,authError=null,limited=false;
 class CourseError extends Error{constructor(status,message){super(message);this.status=status;}}
 const route=await loadService('app/api/course/progress/route.ts',{courseProgressInput,CourseError,courseHeaders:{'Cache-Control':'private, no-store'},courseAccess:async()=>{if(authError)throw new CourseError(401,'Sign in');return {accountId:account,userId:user};},courseError:e=>Response.json({error:e.message},{status:e.status??503}),allowedOrigin:()=>allowed,limitRequest:async(req,scope,id)=>{assert.equal(scope,'course-progress');assert.equal(id,account);if(limited)throw Object.assign(new Error('Limited'),{status:429});},db});
 const body={revision:2,durationMs:100000,ranges:[[0,25000]]};
 const request=(value=body)=>new Request('https://example.invalid/api/course/progress',{method:'POST',body:JSON.stringify(value)});
 assert.equal((await (await route.POST(request())).json()).percent,25);
 allowed=false;assert.equal((await route.POST(request())).status,403);allowed=true;
 authError=true;assert.equal((await route.POST(request())).status,401);authError=null;
 assert.equal((await route.POST(request({...body,accountId:other}))).status,400);
 limited=true;assert.equal((await route.POST(request())).status,429);limited=false;
 assert.equal((await route.POST(request({...body,revision:1}))).status,409);
 for(const role of ['anon','authenticated']){await pg.exec('reset role;set role '+role);await assert.rejects(()=>q('select * from icash_course_progress'));await assert.rejects(()=>rpc('icash_read_course_progress',{p_account:account}));await assert.rejects(()=>rpc('icash_record_course_progress',input));}
}finally{await pg.close();}
const ready=['work','credits','readiness'].map(key=>({key,status:'ok',detail:'Ready',source:'fixture',observedAt:'2026-10-17T23:00:00Z'}));
for(const [state,percent] of [['unrecorded',null],['in_progress',25],['completed',100]]){
 const course=courseProgressEvidence({state,percent,revision:2});
 const answer=supportConversationFallback({kind:'account',messages:[{role:'user',content:'How do I get clients?'}],evidence:[...ready,{key:'course',source:'fixture',observedAt:'2026-10-17T23:00:00Z',...course}]});
 assert.match(answer.reply,/bot finds and works eligible seller leads automatically/);
 assert.doesNotMatch(answer.reply,/playback|Course|credits?|readiness|Keep it running/i,'A question about how leads arrive does not request a course or account-check report');
 assert.equal(answer.status,'resolved');
}
assert.match(courseProgressEvidence({state:'unavailable',percent:null,revision:null}).detail,/Do not infer/);
console.log('PASS course progress: played ranges, seeking, deduplicated cross-device coverage, current-video binding, tenant/auth/CSRF/rate boundaries, private grants and grounded support guidance. No external calls.');
