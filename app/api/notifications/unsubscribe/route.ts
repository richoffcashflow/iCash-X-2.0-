import {db} from '@/lib/stripe-test';
import {unsubscribePattern} from '@/lib/attention-notifications';
export const dynamic = 'force-dynamic';
const headers = {'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"};
const page = (text: string, form = '') => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>iCash X email alerts</title><body><main><h1>iCash X email alerts</h1><p>${text}</p>${form}<p><a href="/?notifications=1">Manage preferences in iCash X</a></p></main></body></html>`;
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  if (!unsubscribePattern.test(token)) return new Response(page('This link is invalid. Sign in to turn off email alerts in your account preferences.'), {status: 400, headers});
  // Mail scanners follow GET links. Only a deliberate form submit / RFC 8058
  // one-click POST changes the preference. The token can only disable alerts.
  return new Response(page('Turn off all optional account attention emails? Your tasks will remain in the workspace.', '<form method="post"><button type="submit">Turn off email alerts</button></form>'), {headers});
}
export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  if (!unsubscribePattern.test(token)) return new Response(page('This link is invalid. Sign in to manage email alerts.'), {status: 400, headers});
  try {
    await db('rpc/icash_unsubscribe_attention', 'POST', {p_token: token});
    return new Response(page('Email alerts are off for this link. You can turn them on again from your account preferences.'), {headers});
  } catch { return new Response(page('Could not update email alerts right now. Please retry, or sign in to turn them off in your account preferences.'), {status: 503, headers}); }
}
