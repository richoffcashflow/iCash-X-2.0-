import {db} from '@/lib/stripe-test';
import {renderBuyerPackage,type BuyerPackage} from '@/lib/buyer-disposition';
export const dynamic='force-dynamic';
export async function GET(_req:Request,{params}:{params:Promise<{token:string}>}){
 const headers={'Cache-Control':'private, no-store','Content-Type':'text/html; charset=utf-8','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; img-src https://img.dealmachine.com https://api.contiguity.com; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"};
 try{const {token}=await params;if(!/^[a-f0-9]{32}$/.test(token))throw Error();const p=await db<BuyerPackage|null>('rpc/icash_read_buyer_package','POST',{p_token:token});if(!p)throw Error();return new Response(renderBuyerPackage(p),{headers});}
 catch{return new Response('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Deal unavailable</title><p>This deal package is no longer available. Please contact the sender.</p></html>',{status:404,headers});}
}
