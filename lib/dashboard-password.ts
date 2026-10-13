import {cookies} from 'next/headers';
import {currentUser} from '@/lib/account-auth';
import {workAccount} from '@/lib/work-account';
import {dashboardCookie,validDashboardProof} from './dashboard-password-policy';

export async function requireDashboardPassword(userId:string){
 const jar=await cookies();
 if(!validDashboardProof(jar.get(dashboardCookie)?.value,jar.get('icash_access')?.value,process.env.SUPABASE_SECRET_KEY,userId))throw Error('DASHBOARD_PASSWORD_REQUIRED');
}
export async function dashboardCurrentUser(refresh=false){
 const user=await currentUser(refresh);if(user)await requireDashboardPassword(user.id);return user;
}
export async function dashboardWorkAccount(options:Parameters<typeof workAccount>[0]={}){
 const owner=await workAccount(options);await requireDashboardPassword(owner.userId);return owner;
}
