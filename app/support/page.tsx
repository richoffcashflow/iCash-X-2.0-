import {supportId} from '@/lib/support-policy';
import {SupportChat} from '@/components/support-chat';
import './support.css';
export const metadata={title:'Help | iCash X'};
export default async function SupportPage({searchParams}:{searchParams:Promise<{threadId?:string|string[]}>}){
 const {threadId}=await searchParams;const parsed=supportId.safeParse(threadId);const initialThreadId=parsed.success?parsed.data:undefined;
 return <main className="support-page"><SupportChat initialThreadId={initialThreadId}/></main>;
}
