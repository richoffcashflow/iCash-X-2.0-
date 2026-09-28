/** Organize trusted tenant-scoped records; no fabricated totals or earnings. */
export type WorkspaceDeal = { id:string;tenantId:string;ownerId:string;status:"active"|"closed"|"failed";sellerSigned:boolean;stage:"research"|"seller"|"buyer"|"title"|"closing";needsUser:boolean;deadlineAt:number|null;promiseScore:number;scoreVerified:boolean;closedAt:number|null };
export function workspacePriority(tenantId:string,deals:WorkspaceDeal[],now:number) {
  if(!tenantId || !Number.isFinite(now))throw new Error("Invalid workspace");
  const seen=new Set<string>();
  const own=deals.filter(d=>d.tenantId===tenantId && d.id && !seen.has(d.id) && !!seen.add(d.id));
  const active=own.filter(d=>d.status==='active');
  const stageWeight={research:0,seller:1,buyer:2,title:3,closing:4};
  const deadline=(d:WorkspaceDeal)=>d.deadlineAt!==null&&Number.isFinite(d.deadlineAt)?d.deadlineAt:Infinity;
  const urgent=(d:WorkspaceDeal)=>deadline(d)-now<=48*3600000;
  const score=(d:WorkspaceDeal)=>d.scoreVerified&&Number.isFinite(d.promiseScore)?Math.max(0,Math.min(100,d.promiseScore)):0;
  const ranked=[...active].sort((a,b)=>Number(b.needsUser)-Number(a.needsUser)||Number(urgent(b))-Number(urgent(a))||(urgent(a)&&urgent(b)?deadline(a)-deadline(b):0)||Number(b.sellerSigned)-Number(a.sellerSigned)||stageWeight[b.stage]-stageWeight[a.stage]||score(b)-score(a)||a.id.localeCompare(b.id));
  const closed=own.filter(d=>d.status==='closed'&&d.closedAt!==null&&Number.isFinite(d.closedAt)&&d.closedAt<=now).sort((a,b)=>b.closedAt!-a.closedAt!);
  const ownerThreads:Record<string,string[]>={};
  for(const d of active)if(d.ownerId) {const ids=Object.hasOwn(ownerThreads,d.ownerId)?ownerThreads[d.ownerId]:[];Object.defineProperty(ownerThreads,d.ownerId,{value:[...ids,d.id],enumerable:true,configurable:true,writable:true});}
  return { needsYou:ranked.filter(d=>d.needsUser).map(d=>d.id), pinned:ranked.filter(d=>d.sellerSigned).map(d=>d.id), featuredLead:ranked.find(d=>!d.sellerSigned&&d.scoreVerified)?.id??null, closingCount:active.filter(d=>d.stage==='closing'&&d.sellerSigned).length, verifiedClosedCount:closed.length, history:closed.map(d=>d.id), ownerThreads };
}
