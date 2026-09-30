import {attentionEmail, attentionEmailConfiguration, uuidPattern, type AttentionJob} from './attention-notifications.ts';

type Database = <T>(path: string, method?: string, body?: unknown, signal?: AbortSignal) => Promise<T>;
type Dependencies = {db: Database; transport?: typeof fetch; env?: Record<string, string | undefined>; signal?: AbortSignal};
/** One bounded attempt. An uncertain provider result is never automatically resent. */
export async function dispatchAttentionNotification(accountId: string, dependencies: Dependencies) {
  const config = attentionEmailConfiguration(dependencies.env ?? process.env);
  if (!config) return {status: 'attention_disabled'};
  if (!uuidPattern.test(accountId)) return {status: 'attention_held'};
  const signal = dependencies.signal ? AbortSignal.any([dependencies.signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000);
  const db = dependencies.db;
  let id: string | null = null;
  try {
    signal.throwIfAborted();
    id = await db<string | null>('rpc/icash_claim_attention_email', 'POST', {p_account: accountId}, signal);
    if (!id) return {status: 'attention_idle'};
    if (!uuidPattern.test(id)) throw Error('Invalid claim');
    // This second, one-use authorization rechecks current task state, opt-in,
    // category, verified owner/email, suppression and global availability.
    const job = await db<AttentionJob | null>('rpc/icash_authorize_attention_email', 'POST', {p_account: accountId, p_id: id}, signal);
    if (!job) return {status: 'attention_held'};
    if (job.id !== id) throw Error('Claim mismatch');
    const message = attentionEmail(job, config.origin, config.from);
    signal.throwIfAborted();
    const response = await (dependencies.transport ?? fetch)('https://api.resend.com/emails', {
      method: 'POST', redirect: 'error', signal,
      headers: {Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `attention-${id}`},
      body: JSON.stringify(message),
    });
    if (!response.ok) throw Error('Provider response needs review');
    const receipt = await response.json();
    if (!receipt || typeof receipt.id !== 'string' || !uuidPattern.test(receipt.id)) throw Error('Missing provider receipt');
    await db('rpc/icash_finish_attention_email', 'POST', {p_account: accountId, p_id: id, p_provider: receipt.id}, signal);
    return {status: 'attention_accepted'};
  } catch {
    // Even if this bookkeeping fails or the enclosing request has timed out,
    // the durable claim is consumed. It cannot send a duplicate on another tick.
    if (id && uuidPattern.test(id) && !signal.aborted) {
      try { await db('rpc/icash_finish_attention_email', 'POST', {p_account: accountId, p_id: id, p_provider: null}, signal); } catch { /* Reconciliation only. */ }
    }
    return {status: 'attention_needs_review'};
  }
}
