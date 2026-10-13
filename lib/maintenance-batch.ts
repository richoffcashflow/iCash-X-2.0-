/** One invocation, independent recovery lanes. Never repeat a failed provider action. */
export async function maintenanceBatch(tasks:Record<string,()=>Promise<Response>>){
 const entries=Object.entries(tasks);
 const results=await Promise.allSettled(entries.map(([,run])=>Promise.resolve().then(run)));
 const lanes=Object.fromEntries(results.map((result,index)=>[entries[index][0],
  result.status==='fulfilled'?{ok:result.value.ok,status:result.value.status}:{ok:false,status:503}]));
 return {lanes,ok:Object.values(lanes).every(lane=>lane.ok)};
}
