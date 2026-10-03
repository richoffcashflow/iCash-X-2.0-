import {db} from '@/lib/stripe-test';
import {unsubscribePattern} from '@/lib/attention-notifications';
const headers={'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'"};
export function GET(request:Request){
 const token=new URL(request.url).searchParams.get('token');if(!token||!unsubscribePattern.test(token))return new Response('Invalid link',{status:400});
 return new Response(`<html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1"><title>iCash X updates</title><body style="font:16px system-ui;max-width:32rem;margin:4rem auto;padding:1rem"><h1>Stop bot activity updates?</h1><p>This turns off email and text activity updates. Your bot and daily budget stay as they are.</p><form method="post"><button style="font:inherit;padding:1rem">Stop activity updates</button></form></body></html>`,{headers});
}
export async function POST(request:Request){
 const token=new URL(request.url).searchParams.get('token');if(!token||!unsubscribePattern.test(token))return new Response('Invalid link',{status:400});
 try{await db('rpc/icash_stop_customer_updates','POST',{p_token:token});return new Response('<html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Updates stopped</title><body style="font:16px system-ui;padding:2rem"><h1>Activity updates are off.</h1><p>Your bot and daily budget have not changed. You can manage them in your workspace.</p><a href="/">Open iCash X</a></body></html>',{headers});}catch{return new Response('Could not confirm. Please retry or turn off updates in your workspace.',{status:503,headers});}
}
