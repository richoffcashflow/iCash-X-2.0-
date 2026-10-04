import {verifyTitleWebhook} from '@/lib/title-inbound-policy';
import {db} from '@/lib/stripe-test';
export async function POST(req:Request){
 const secret=process.env.ICASH_WEBINAR_EMAIL_WEBHOOK_SECRET;if(!secret)return new Response(null,{status:503});
 try{const raw=await req.text();if(raw.length>65536)return new Response(null,{status:413});const event=verifyTitleWebhook(raw,req.headers,secret);
 if(!['email.bounced','email.complained','email.suppressed'].includes(event.type))return Response.json({received:true});
 const id=event.data?.email_id;if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))return new Response(null,{status:400});
 await db('rpc/icash_webinar_email_event','POST',{p_email:id,p_kind:event.type});
 return Response.json({received:true});
 }catch{return new Response(null,{status:400});}
}
