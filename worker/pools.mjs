/** Dedicated capacity, with a staged 8 -> 16 rollout. These are job slots,
 * never a replacement for database/provider/recipient spending admission. */
export function automationPools(env=process.env){
 const count=Number(env.ICASH_AUTOMATION_CONCURRENCY??'8');
 if(![8,16].includes(count))throw Error('INVALID_WORKER_CONCURRENCY');
 const group=['general','recovery','messages','voice','research','messages','voice','research'];
 return count===8?group:[...group,...group];
}
