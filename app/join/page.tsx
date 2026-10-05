import {redirect} from 'next/navigation';
import {MembershipJoin} from '@/components/membership-join';
export default async function JoinPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){const query=await searchParams;if(!query.membership&&!query.session_id)redirect('/#setup');return <MembershipJoin/>;}
