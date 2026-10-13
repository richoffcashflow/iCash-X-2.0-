import {NextResponse,type NextRequest} from 'next/server';
import {dashboardCookie,validDashboardProof} from './lib/dashboard-password-policy';
import {dashboardPath} from './lib/dashboard-paths';

// Navigation convenience only. Every privileged API also checks the proof server-side.
export function proxy(request:NextRequest){
 if(dashboardPath(request.nextUrl.pathname)&&!validDashboardProof(request.cookies.get(dashboardCookie)?.value,request.cookies.get('icash_access')?.value,process.env.SUPABASE_SECRET_KEY)){
  const url=new URL('/dashboard-unlock',request.url);url.searchParams.set('next',request.nextUrl.pathname+request.nextUrl.search);
  const response=NextResponse.redirect(url);response.headers.set('Cache-Control','private, no-store');return response;
 }
 const response=NextResponse.next();response.headers.set('Cache-Control','private, no-store');return response;
}
export const config={matcher:['/admin/:path*','/webinaradmin/:path*','/webinar-studio/:path*','/messagingadmin/:path*','/owner-pricing/:path*','/seller-operations/:path*','/owner-reception/:path*','/owner-inbound-acceptance/:path*','/owner-voice-acceptance/:path*','/owner-recording-test/:path*','/support/admin/:path*','/support/buyer-reviews/:path*','/voice-test/:path*','/test-bot/:path*']};
