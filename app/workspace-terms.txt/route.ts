import {workspaceAcknowledgmentDocument} from '@/lib/workspace-acknowledgment-policy';
export function GET(){return new Response(workspaceAcknowledgmentDocument,{headers:{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':'attachment; filename="iCash-X-workspace-terms.txt"','Cache-Control':'no-store'}});}
