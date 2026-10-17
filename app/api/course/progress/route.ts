import {courseAccess,courseError,courseHeaders,CourseError} from '@/lib/course-server';
import {allowedOrigin} from '@/lib/funding-policy';
import {limitRequest} from '@/lib/funding';
import {db} from '@/lib/stripe-test';
import {courseProgressInput} from '@/lib/course-progress';
export const runtime='nodejs';
export async function POST(req:Request){
 try{
  if(!allowedOrigin(req))throw new CourseError(403,'Open the course directly and try again.');
  const {accountId,userId}=await courseAccess();
  const raw=await req.text();if(raw.length>8000)throw new CourseError(413,'Progress update is too large.');
  let value:unknown;try{value=JSON.parse(raw);}catch{throw new CourseError(400,'Invalid viewing progress.');}
  const parsed=courseProgressInput.safeParse(value);if(!parsed.success)throw new CourseError(400,'Invalid viewing progress.');
  await limitRequest(req,'course-progress',accountId,30,60);
  const i=parsed.data;
  const progress=await db('rpc/icash_record_course_progress','POST',{p_account:accountId,p_user:userId,p_revision:i.revision,p_duration:i.durationMs,p_ranges:i.ranges});
  if(!progress)throw new CourseError(409,'The course has changed. Refresh the course page.');
  return Response.json(progress,{headers:courseHeaders});
 }catch(e){if(e instanceof Error&&'status' in e&&e.status===429)return Response.json({error:'Please wait before saving more progress.'},{status:429,headers:{...courseHeaders,'Retry-After':'60'}});return courseError(e);}
}
