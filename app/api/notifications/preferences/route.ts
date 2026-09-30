import {NextResponse} from 'next/server';
import {z} from 'zod';
import {workAccount} from '@/lib/work-account';
import {allowedOrigin} from '@/lib/funding-policy';
import {db} from '@/lib/stripe-test';
import {attentionCategories, attentionConsentVersion, attentionEmailConfiguration} from '@/lib/attention-notifications';
export const dynamic = 'force-dynamic';
const headers = {'Cache-Control': 'private, no-store'};
const input = z.object({enabled: z.boolean(), categories: z.array(z.enum(attentionCategories)).max(4), consentVersion: z.literal(attentionConsentVersion).optional()}).strict();
export async function GET() {
  try {
    const {accountId, userId} = await workAccount();
    const preferences = await db<Record<string, unknown>>('rpc/icash_attention_preferences', 'POST', {p_account: accountId, p_user: userId});
    return NextResponse.json({...preferences, available: !!attentionEmailConfiguration(process.env) && preferences.available === true, consentVersion: attentionConsentVersion}, {headers});
  } catch { return NextResponse.json({error: 'Email alert preferences are temporarily unavailable. Your in-app tasks are still available.'}, {status: 503, headers}); }
}
export async function POST(request: Request) {
  if (!allowedOrigin(request)) return NextResponse.json({error: 'Open iCash X directly and try again.'}, {status: 403, headers});
  try {
    const {accountId, userId} = await workAccount();
    const raw = await request.text();
    if (raw.length > 512) return NextResponse.json({error: 'Invalid preferences.'}, {status: 400, headers});
    const parsed = input.safeParse(JSON.parse(raw));
    if (!parsed.success) return NextResponse.json({error: 'Choose your email alert preferences.'}, {status: 400, headers});
    const {enabled, categories, consentVersion} = parsed.data;
    if (enabled && (!categories.length || consentVersion !== attentionConsentVersion)) return NextResponse.json({error: 'Choose at least one alert and confirm email delivery.'}, {status: 400, headers});
    // Turning alerts off must remain possible even when dispatch is unavailable.
    if (enabled && !attentionEmailConfiguration(process.env)) return NextResponse.json({error: 'Email alerts are not available yet. Check Needs you in your workspace.'}, {status: 503, headers});
    const preferences = await db('rpc/icash_save_attention_preferences', 'POST', {p_account: accountId, p_user: userId, p_enabled: enabled, p_categories: [...new Set(categories)], p_consent: consentVersion ?? null});
    return NextResponse.json({saved: true, preferences}, {headers});
  } catch { return NextResponse.json({error: 'Could not confirm your email preference. Reload to check it, or retry.'}, {status: 503, headers}); }
}
