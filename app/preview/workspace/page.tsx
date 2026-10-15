import {notFound,redirect} from 'next/navigation';
import type {Metadata} from 'next';
import {WorkspacePreview} from './workspace-preview';
import {dashboardCurrentUser} from '@/lib/dashboard-password';
import {ownerInboundTarget} from '@/lib/owner-inbound-acceptance';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'iCash X workspace preview',robots:{index:false,follow:false}};
export default async function Page(){
 if(process.env.VERCEL_ENV!=='preview'&&process.env.NODE_ENV!=='development'){
  let user;
  try{user=await dashboardCurrentUser();}catch(error){
   if(error instanceof Error&&error.message==='DASHBOARD_PASSWORD_REQUIRED')redirect('/dashboard-unlock?next=%2Fpreview%2Fworkspace');
   throw error;
  }
  if(!user)redirect('/dashboard-unlock?next=%2Fpreview%2Fworkspace');
  if(user.id!==ownerInboundTarget.ownerUserId)notFound();
 }
 return <WorkspacePreview/>;
}
