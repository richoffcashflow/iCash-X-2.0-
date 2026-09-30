/** Customer email alerts contain links and generic task labels, never deal content. */
export const attentionConsentVersion = '2026-09-30-attention-email-1';
export const attentionCategories = ['needs_you', 'signatures', 'callbacks', 'closing'] as const;
export type AttentionCategory = typeof attentionCategories[number];
export type AttentionKind = 'text_attention' | 'handoff' | 'sms_callback' | 'live_callback' | 'signature' | 'title_review' | 'closing_deadline';
export type AttentionPreferences = {
  enabled: boolean;
  categories: AttentionCategory[];
  consentVersion: string | null;
  suppressed: boolean;
};
export type AttentionJob = {
  id: string;
  kind: AttentionKind;
  screeningId: string;
  recipient: string;
  unsubscribeToken: string;
  pendingCount: number;
};
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const unsubscribePattern = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}){2}$/i;
const emailPattern = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i;
const copy: Record<AttentionKind, {title: string; detail: string; focus: string}> = {
  text_attention: {title: 'A request needs your review', detail: 'A saved request in your workspace needs your attention.', focus: 'needs_you'},
  handoff: {title: 'Your assistant needs your input', detail: 'Your assistant saved a request for you to review.', focus: 'needs_you'},
  sms_callback: {title: 'Review a callback request', detail: 'A callback request needs your review. This does not confirm a scheduled call.', focus: 'callback'},
  live_callback: {title: 'A callback needs your attention', detail: 'A saved callback is held for you or marked missed. Check its current status in your workspace.', focus: 'callback'},
  signature: {title: 'Review a signing request', detail: 'A signing request is waiting for your review. Open the property to see its current status before signing.', focus: 'signature'},
  title_review: {title: 'Review a title task', detail: 'A title task needs your review. A date mentioned in a title message may still need your confirmation.', focus: 'title_review'},
  closing_deadline: {title: 'Review an upcoming or overdue deadline', detail: 'A confirmed title deadline is within two days or overdue. Open the property to review the date and next step.', focus: 'closing_deadline'},
};

export function attentionEmailConfiguration(env: Record<string, string | undefined>) {
  if (env.ICASH_ATTENTION_EMAIL_ENABLED !== 'true' || !env.RESEND_API_KEY || !env.ICASH_ATTENTION_WEBHOOK_SECRET?.startsWith('whsec_')) return null;
  const from = env.ICASH_ATTENTION_FROM_EMAIL ?? '';
  if (from.length > 254 || !emailPattern.test(from)) return null;
  try {
    const url = new URL(env.ICASH_APP_ORIGIN ?? '');
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !url.hostname.includes('.')) return null;
    return {from, origin: url.origin, apiKey: env.RESEND_API_KEY};
  } catch { return null; }
}

export function attentionEmail(job: AttentionJob, origin: string, from: string) {
  if (!uuidPattern.test(job.id) || !uuidPattern.test(job.screeningId) || !unsubscribePattern.test(job.unsubscribeToken) || typeof job.recipient !== 'string' || job.recipient.length > 254 || !emailPattern.test(job.recipient) || !Object.hasOwn(copy, job.kind) || !Number.isSafeInteger(job.pendingCount) || job.pendingCount < 1) throw Error('Invalid notification claim');
  const details = copy[job.kind];
  const work = new URL('/', origin);
  work.searchParams.set('screeningId', job.screeningId);
  work.searchParams.set('attentionKind', details.focus);
  const preferences = new URL('/?notifications=1', origin);
  const unsubscribe = new URL('/api/notifications/unsubscribe', origin);
  unsubscribe.searchParams.set('token', job.unsubscribeToken);
  return {
    from: `iCash X <${from}>`,
    to: [job.recipient],
    subject: `iCash X: ${details.title}`,
    text: `${details.detail}\n\nOpen this property's work (sign-in required):\n${work.href}\n\n${job.pendingCount} saved ${job.pendingCount === 1 ? 'task matches' : 'tasks match'} your alert choices. Review all your tasks in the workspace: ${new URL('/', origin).href}\n\nThis alert reflects saved tasks. They may have changed since this email was sent.\n\nYou chose these account alerts. We send at most 3 per 24 hours, at least 1 hour apart. They do not replace checking your workspace for time-sensitive tasks.\n\nManage email alerts: ${preferences.href}\nTurn off these alerts: ${unsubscribe.href}\n\niCash X`,
    tags: [{name: 'icash_attention_id', value: job.id}],
    headers: {'List-Unsubscribe': `<${unsubscribe.href}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'},
  };
}
