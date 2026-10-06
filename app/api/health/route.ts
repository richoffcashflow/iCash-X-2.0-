import {NextResponse} from 'next/server';
import {serviceHealth} from '@/lib/service-health';
export const dynamic='force-dynamic';
export const maxDuration=10;

export async function GET(){
 const health=await serviceHealth();
 return NextResponse.json(health,{status:health.status==='ok'?200:503,headers:{'Cache-Control':'no-store','Retry-After':health.status==='ok'?'10':'5'}});
}
