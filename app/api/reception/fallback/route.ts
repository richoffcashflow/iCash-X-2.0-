import {rejectTwiml} from '@/lib/general-reception';
export const runtime='nodejs';
export const dynamic='force-dynamic';
// Configure both number and TwiML application fallback here. Never a native AI fallback.
export async function POST(){return new Response(rejectTwiml,{headers:{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'no-store'}});}
export const GET=POST;
