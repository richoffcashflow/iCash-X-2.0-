import {webinarError,webinarHeaders,webinarOrigin,webinarOwner} from '@/lib/webinar-server';
export const dynamic='force-dynamic';
export async function GET(){try{await webinarOwner();return Response.json({enabled:false,retired:true},{headers:webinarHeaders});}catch(e){return webinarError(e);}}
export async function POST(req:Request){try{webinarOrigin(req);await webinarOwner();return Response.json({enabled:false,error:'Automatic testing has been removed. Use each webinar’s permanent link.'},{status:410,headers:webinarHeaders});}catch(e){return webinarError(e);}}
