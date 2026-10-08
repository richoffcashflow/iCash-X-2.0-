import {customerPhoneWebhook} from '@/lib/customer-phone';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=30;
export async function POST(request:Request,{params}:{params:Promise<{part:string}>}){const {part}=await params;if(!['answer','connect','status','child','done','recording'].includes(part))return new Response(null,{status:404});return customerPhoneWebhook(request,part);}
