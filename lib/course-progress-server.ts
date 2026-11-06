import {db} from '@/lib/stripe-test';
import {courseProgressSchema} from './course-progress';
import {fundingMode} from './funding-policy';
import {z} from 'zod';
export async function readCourseProgress(accountId:string){
 return courseProgressSchema.parse(await db('rpc/icash_read_course_progress','POST',{p_account:accountId}));
}

const workspaceCourseStatus=z.object({course:courseProgressSchema,priorPlayback:z.boolean(),courseUpdated:z.boolean()});
export async function readWorkspaceCourseStatus(accountId:string){
 return workspaceCourseStatus.parse(await db('rpc/icash_workspace_course_status','POST',{p_account:accountId,p_mode:fundingMode()}));
}
