import {NextResponse} from 'next/server';
import {z} from 'zod';
import {currentUser} from '@/lib/account-auth';
import {ownerInboundTarget} from '@/lib/owner-inbound-acceptance';
import {db} from '@/lib/stripe-test';
import {allowedOrigin,fundingMode} from '@/lib/funding-policy';
import {membershipOffer} from '@/lib/membership';
const headers={'Cache-Control':'private, no-store'};
async function owner(){const user=await currentUser(true);if(user?.id!==ownerInboundTarget.ownerUserId)throw Error('OWNER_REQUIRED');return user;}
export async function GET(){try{await owner();return NextResponse.json({offer:await membershipOffer()},{headers});}catch{return NextResponse.json({error:'Sign in with the platform owner account.'},{status:403,headers});}}
export async function POST(req:Request){if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403,headers});try{const user=await owner();if(fundingMode()!=='live')return NextResponse.json({error:'Edit software pricing from the production owner account.'},{status:409,headers});const raw=await req.text();if(raw.length>512)throw Error();const i=z.object({priceCents:z.number().int().min(100).max(100000),revision:z.number().int().positive(),enabled:z.boolean()}).strict().parse(JSON.parse(raw));const rows=await db<unknown[]>(`icash_membership_offer?id=eq.1&revision=eq.${i.revision}`,'PATCH',{price_cents:i.priceCents,enabled:i.enabled,revision:i.revision+1,updated_by:user.id,updated_at:new Date().toISOString()});if(rows.length!==1)return NextResponse.json({error:'The offer changed in another tab. Refresh before saving.'},{status:409,headers});return NextResponse.json({saved:true,offer:await membershipOffer()},{headers});}catch{return NextResponse.json({error:'Price was not saved. Check owner access and enter $1–$1,000.'},{status:400,headers});}}
