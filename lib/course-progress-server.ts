import {db} from '@/lib/stripe-test';
import {courseProgressSchema} from './course-progress';
export async function readCourseProgress(accountId:string){
 return courseProgressSchema.parse(await db('rpc/icash_read_course_progress','POST',{p_account:accountId}));
}
