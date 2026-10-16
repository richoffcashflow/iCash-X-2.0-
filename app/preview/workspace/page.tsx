import type {Metadata} from 'next';
import {WorkspacePreview} from './workspace-preview';
import {coursePreviewContracts} from '@/lib/course-preview-contracts';

export const metadata:Metadata={title:'Practice workspace · iCash X',robots:{index:false,follow:false}};
// Public, inert learning fixtures. No account lookup, credentials or live work actions.
export default function Page(){return <WorkspacePreview contracts={coursePreviewContracts()}/>;}
