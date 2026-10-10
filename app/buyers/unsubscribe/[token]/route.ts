import {db} from '@/lib/stripe-test';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Content-Type':'text/html; charset=utf-8','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"};
function page(body:string){return `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HomeOffer Network · Email preferences</title><style>body{font:17px/1.6 system-ui;color:#171717;max-width:500px;margin:12vh auto;padding:24px}button{padding:16px 24px;background:#171717;color:white;border:0;border-radius:12px;font:inherit;cursor:pointer}a{color:inherit}</style><main><p>HOME OFFER NETWORK</p>${body}</main></html>`;}
export async function GET(_req:Request,{params}:{params:Promise<{token:string}>}){
 const {token}=await params;if(!/^[a-f0-9]{32}$/.test(token))return new Response(page('<h1>Link unavailable</h1>'),{status:404,headers});
 // Link scanners cannot unsubscribe a buyer by fetching this page.
 return new Response(page('<h1>Stop network emails?</h1><p>You can rejoin anytime by verifying your email and saving your preferences.</p><form method="post"><button>Stop network emails</button></form>'),{headers});
}
export async function POST(_req:Request,{params}:{params:Promise<{token:string}>}){
 const {token}=await params;if(!/^[a-f0-9]{32}$/.test(token))return new Response(page('<h1>Link unavailable</h1>'),{status:404,headers});
 try{await db('rpc/icash_network_pause','POST',{p_user:null,p_token:token});return new Response(page('<h1>Network emails stopped</h1><p>Your buying preferences are saved.</p><a href="/buyers">Manage preferences</a>'),{headers});}
 catch{return new Response(page('<h1>Could not save</h1><p>Please try again.</p><form method="post"><button>Retry</button></form>'),{status:503,headers});}
}
