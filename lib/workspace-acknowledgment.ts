import {createHash} from 'node:crypto';
import {workspaceAcknowledgmentDocument,workspaceAcknowledgmentVersion} from './workspace-acknowledgment-policy.ts';
export const workspaceAcknowledgmentHash=createHash('sha256').update(workspaceAcknowledgmentDocument).digest('hex');
export type WorkspaceAcknowledgmentRecord={workspace_ack_version?:string|null;workspace_ack_user_id?:string|null;workspace_ack_hash?:string|null};
export function workspaceAcknowledgmentCurrent(record:WorkspaceAcknowledgmentRecord,userId:string){
 return record.workspace_ack_user_id===userId&&record.workspace_ack_version===workspaceAcknowledgmentVersion&&record.workspace_ack_hash===workspaceAcknowledgmentHash;
}
