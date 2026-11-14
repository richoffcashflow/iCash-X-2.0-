const object=(value:unknown):Record<string,unknown>|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
const keys=(value:Record<string,unknown>|null,expected:string[])=>value!==null&&Object.keys(value).length===expected.length&&expected.every(key=>Object.hasOwn(value,key));
const empty=(value:unknown)=>keys(object(value),[]);

/** Only the observed version-one, disconnected Start scaffold. Preserve the
 * existing loop-prevention value: true and false are separate fingerprints.
 * Removing serialization metadata is never a substitute for the caller's
 * complete original configuration/identity approval. */
export function unversionedInertWorkflow(value:unknown):Record<string,unknown>|null{
 const workflow=object(value),nodes=object(workflow?.nodes),start=object(nodes?.start_node),position=object(start?.position);
 if(!workflow||!nodes||!start||!position)return null;
 if(!keys(workflow,['edges','nodes','frames','version','subgraphs','prevent_subagent_loops'])
  ||workflow.version!==1||typeof workflow.prevent_subagent_loops!=='boolean'
  ||!empty(workflow.edges)||!empty(workflow.frames)||!empty(workflow.subgraphs)
  ||!keys(nodes,['start_node'])||!keys(start,['type','position','edge_order','parent_frame_id','parent_subgraph_id'])
  ||start.type!=='start'||start.parent_frame_id!==null||start.parent_subgraph_id!==null
  ||!Array.isArray(start.edge_order)||start.edge_order.length!==0
  ||!keys(position,['x','y'])||position.x!==0||position.y!==0)return null;
 const previous={...workflow};delete previous.version;
 return previous;
}
