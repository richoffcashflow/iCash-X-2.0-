import {NextResponse} from 'next/server';
import {db} from '@/lib/stripe-test';
import {verifyTitleWebhook} from '@/lib/title-inbound-policy';
import {uuidPattern} from '@/lib/attention-notifications';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  const secret = process.env.ICASH_ATTENTION_WEBHOOK_SECRET;
  if (!secret) return new Response(null, {status: 503});
  let event;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 65536) return new Response(null, {status: 413});
    event = verifyTitleWebhook(raw, request.headers, secret);
  } catch { return new Response(null, {status: 400}); }
  if (!['email.delivered', 'email.bounced', 'email.complained', 'email.failed', 'email.suppressed'].includes(event?.type)) return NextResponse.json({received: true});
  const id = event?.data?.tags?.icash_attention_id;
  if (id === undefined) return NextResponse.json({received: true}); // Unrelated application mail.
  if (typeof id !== 'string' || !uuidPattern.test(id)) return new Response(null, {status: 400});
  if (typeof event?.data?.email_id !== 'string' || !uuidPattern.test(event.data.email_id)) return new Response(null, {status: 400});
  if (!Array.isArray(event?.data?.to) || event.data.to.length !== 1 || typeof event.data.to[0] !== 'string' || event.data.to[0].length > 254) return new Response(null, {status: 400});
  try {
    // No message bodies, subjects, recipient overrides or arbitrary account IDs.
    await db('rpc/icash_attention_delivery_event', 'POST', {p_id: id, p_provider: event.data.email_id, p_recipient: event.data.to[0], p_event: event.type});
    return NextResponse.json({received: true});
  } catch { return new Response(null, {status: 503}); }
}
