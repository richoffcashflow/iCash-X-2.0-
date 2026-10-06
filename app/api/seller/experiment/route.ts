import {sellerOptinRoutingRows} from '@/lib/seller-optin-server';
import {cookies} from 'next/headers';
import {randomBytes, randomInt} from 'node:crypto';
import {z} from 'zod';
import {allowedOrigin} from '@/lib/funding-policy';
import {limitRequest, validGuest} from '@/lib/funding';
import {db, guestHash} from '@/lib/stripe-test';
import {sellerOptinSource, sellerOptinCampaign, sellerOptinPlan, chooseSellerOptin} from '@/lib/seller-optin';

export const dynamic = 'force-dynamic';
const headers = {'Cache-Control': 'private, no-store'};
const input = z.object({event: z.enum(['open','view','start','contact']), source: z.string().max(50).optional(), campaign: z.string().max(150).optional()}).strict();

export async function POST(req: Request) {
  if (!allowedOrigin(req)) return Response.json({error: 'Invalid origin'}, {status: 403, headers});
  // Privacy opt-outs and known crawlers see the baseline without an experiment ID.
  if (req.headers.get('sec-gpc') === '1' || /bot|crawler|spider|headless|preview/i.test(req.headers.get('user-agent') || '')) return Response.json({variant: 'fast_cash', measured: false}, {headers});
  try {
    const raw = await req.text();
    if (raw.length > 600) return Response.json({error: 'Invalid event'}, {status: 400, headers});
    const parsed = input.safeParse(JSON.parse(raw));
    if (!parsed.success) return Response.json({error: 'Invalid event'}, {status: 400, headers});
    const jar = await cookies();
    let token = jar.get('homeoffer_optin')?.value;
    if (!validGuest(token)) {
      if (parsed.data.event !== 'open') return Response.json({measured: false}, {headers});
      token = randomBytes(32).toString('hex');
      jar.set('homeoffer_optin', token, {httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 86400*30});
    }
    await limitRequest(req, 'seller-optin', token, 120, 3600);
    const guest = guestHash(token);
    if (parsed.data.event !== 'open') {
      await db('rpc/icash_record_seller_optin_event', 'POST', {p_guest: guest, p_event: parsed.data.event});
      return Response.json({measured: true}, {headers});
    }
    const existing = await db<{variant: string}[]>(`icash_seller_optin_visits?guest_hash=eq.${guest}&experiment=eq.homeoffer-optin-v1&select=variant&limit=1`);
    if (existing[0]) return Response.json({variant: existing[0].variant, measured: true}, {headers});
    const source = sellerOptinSource(parsed.data.source || null);
    const device = /mobile|android|iphone|ipad/i.test(req.headers.get('user-agent') || '') ? 'mobile' : 'desktop';
    const report = await sellerOptinRoutingRows();
    const plan = sellerOptinPlan(report.filter(r => r.source === source && r.device === device));
    const variant = chooseSellerOptin(plan, randomInt(1000000)/1000000);
    const saved = await db<string>('rpc/icash_open_seller_optin', 'POST', {p_guest: guest, p_variant: variant, p_source: source, p_campaign: sellerOptinCampaign(parsed.data.campaign || null), p_device: device});
    return Response.json({variant: saved, measured: true}, {headers});
  } catch {
    // Analytics must never prevent a homeowner from requesting an offer.
    return Response.json({variant: 'fast_cash', measured: false}, {headers});
  }
}
