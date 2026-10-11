import {db} from '@/lib/stripe-test';
import type {JourneyBlocker} from './deal-completion';
export async function attachTaskRecovery<T extends {id:string}>(accountId:string,tasks:T[]){
 if(!tasks.length)return tasks;
 const recoveries=await db<{taskId:string;journeyId:string;blocker:JourneyBlocker}[]>('rpc/icash_task_recoveries','POST',{p_account:accountId,p_tasks:tasks.slice(0,50).map(t=>t.id)});
 return tasks.map(t=>{const r=recoveries.find(r=>r.taskId===t.id);return r?{...t,recovery:{journeyId:r.journeyId,blocker:r.blocker}}:t;});
}
