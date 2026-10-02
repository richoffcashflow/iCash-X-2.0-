/** Server-only, read-only provider receipts for the owner inbound acceptance test.
 * Credentials must be injected by the existing server runtime. This module never
 * reads process.env, follows provider URLs, provisions credentials, or sends calls.
 * Raw receipts, errors and credentials must never be returned to a public route.
 *
 * Official contracts checked 2026-10-01:
 * https://elevenlabs.io/docs/eleven-agents/operate/versioning
 * https://elevenlabs.io/docs/eleven-agents/api-reference/agents/branches/get
 * https://elevenlabs.io/docs/eleven-agents/api-reference/phone-numbers/get
 * https://elevenlabs.io/docs/eleven-agents/api-reference/conversations/get
 * https://elevenlabs.io/docs/changelog/2026/7/6 (cost_fiat is USD, not credits)
 * https://elevenlabs.io/docs/overview/administration/data-residency
 * https://github.com/elevenlabs/cli (global and US base URLs)
 * https://www.twilio.com/docs/global-infrastructure/understanding-edge-locations
 * https://www.twilio.com/docs/voice/api/call-resource
 */

const elevenOrigins = Object.freeze({
  global: 'https://api.elevenlabs.io',
  us: 'https://api.us.elevenlabs.io',
  eu: 'https://api.eu.residency.elevenlabs.io',
  in: 'https://api.in.residency.elevenlabs.io',
  sg: 'https://api.sg.residency.elevenlabs.io',
});
const twilioOrigins = Object.freeze({
  us1: 'https://api.twilio.com',
  // Region-only non-US hostnames were retired on 2026-04-28.
  ie1: 'https://api.dublin.ie1.twilio.com',
  au1: 'https://api.sydney.au1.twilio.com',
});

export type OwnerInboundProviderConfig = {
  agentId: string;
  branchId: string;
  phoneNumberId: string;
  twilioAccountSid: string;
  elevenLabsRegion: keyof typeof elevenOrigins;
  twilioRegion: keyof typeof twilioOrigins;
};
export type OwnerInboundProviderEnv = {
  ELEVENLABS_API_KEY?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
};
export type OwnerInboundProviderCosts = {
  currency: 'USD';
  twilioCostMicros: number | null;
  elevenLabsCostMicros: number | null;
  totalCostMicros: number | null;
  twilioCostCents: number | null;
  elevenLabsCostCents: number | null;
  totalCostCents: number | null;
  definitive: boolean;
  scope: 'twilio_connectivity_and_elevenlabs_conversation';
  reason: 'unverified_receipts' | 'cost_unknown' | null;
};
type Receipt = Record<string, unknown>;
type ReceiptKind = 'agent' | 'branch' | 'phone' | 'twilio' | 'conversation';
const maximumReceiptBytes = 1024 * 1024;
const providerTimeoutMilliseconds = 8000;
const record = (value: unknown): Receipt | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Receipt : null;

function serverOnly() {
  if (typeof window !== 'undefined') throw Error('OWNER_INBOUND_SERVER_ONLY');
}
function checkedId(value: unknown, expression: RegExp) {
  if (typeof value !== 'string' || value.length > 128 || !expression.test(value)) {
    throw Error('OWNER_INBOUND_PROVIDER_CONFIG_INVALID');
  }
  return value;
}
function origin<T extends Record<string, string>>(allowed: T, region: unknown): string {
  if (typeof region !== 'string' || !Object.hasOwn(allowed, region)) {
    throw Error('OWNER_INBOUND_PROVIDER_REGION_INVALID');
  }
  return allowed[region];
}
function credential(value: unknown) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 4096 || !/^[\x21-\x7e]+$/.test(value)) {
    throw Error('OWNER_INBOUND_PROVIDER_CREDENTIALS_UNAVAILABLE');
  }
  return value;
}
function freezeReceipt(value: unknown): void {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) freezeReceipt(item);
  }
}

/** Exact integer USD micros only: never round or reinterpret credits as dollars.
 * Decimal-string parsing avoids binary-float errors (for example 0.29 * 100).
 * Precision beyond six decimals, exponents and negative charges are not guessed.
 */
function usdMicros(decimal: string): number | null {
  if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,6})?$/.test(decimal)) return null;
  const [whole, fraction = ''] = decimal.split('.');
  const micros = Number(whole) * 1000000 + Number(fraction.padEnd(6, '0'));
  return Number.isSafeInteger(micros) ? micros : null;
}
const exactWholeCents = (micros: number | null) => micros !== null && micros % 10000 === 0 ? micros / 10000 : null;

/** No external receipt injection: cost evidence is limited to this instance's
 * frozen GET responses. The service must still perform exact identity, reviewed
 * branch/version, caller, ingress, forwarding, duration and terminal-state checks.
 */
export function createOwnerInboundProviders(
  config: OwnerInboundProviderConfig,
  options: { fetcher?: typeof fetch; env?: OwnerInboundProviderEnv; signal?: AbortSignal } = {},
) {
  serverOnly();
  const elevenOrigin = origin(elevenOrigins, config.elevenLabsRegion);
  const twilioOrigin = origin(twilioOrigins, config.twilioRegion);
  const agentId = checkedId(config.agentId, /^agent_[A-Za-z0-9]+$/);
  const branchId = checkedId(config.branchId, /^agtbrch_[A-Za-z0-9]+$/);
  const phoneNumberId = checkedId(config.phoneNumberId, /^[A-Za-z0-9][A-Za-z0-9_-]*$/);
  const accountSid = checkedId(config.twilioAccountSid, /^AC[0-9a-fA-F]{32}$/);
  const fetcher = options.fetcher ?? fetch;
  // Snapshot only the injected fields. No implicit use of global runtime secrets.
  const env = {
    ELEVENLABS_API_KEY: options.env?.ELEVENLABS_API_KEY,
    TWILIO_ACCOUNT_SID: options.env?.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: options.env?.TWILIO_AUTH_TOKEN,
  };
  const receipts = new WeakMap<object, ReceiptKind>();

  async function get(url: string, headers: Record<string, string>, kind: ReceiptKind): Promise<unknown> {
    serverOnly();
    const timeout = AbortSignal.timeout(providerTimeoutMilliseconds);
    const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
    let response: Response;
    try {
      response = await fetcher(url, {
        method: 'GET', headers: { Accept: 'application/json', ...headers },
        cache: 'no-store', redirect: 'error', credentials: 'omit', signal,
      });
    } catch {
      throw Error('OWNER_INBOUND_PROVIDER_UNAVAILABLE');
    }
    // No retry, no regional fallback, and no raw provider error text in exceptions.
    if (!response.ok || response.redirected || (response.url && response.url !== url)) {
      throw Error('OWNER_INBOUND_PROVIDER_UNAVAILABLE');
    }
    let receipt: Receipt | null;
    try {
      const declaredLength = response.headers.get('content-length');
      if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maximumReceiptBytes)) throw Error();
      if (!/^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)(?:;|$)/i.test(response.headers.get('content-type') ?? '')) throw Error();
      if (!response.body) throw Error();
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          signal.throwIfAborted();
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > maximumReceiptBytes) throw Error();
          chunks.push(value);
        }
      } catch {
        await reader.cancel().catch(() => undefined);
        throw Error();
      } finally {
        reader.releaseLock();
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      receipt = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
      if (!receipt) throw Error();
      freezeReceipt(receipt);
    } catch {
      throw Error('OWNER_INBOUND_PROVIDER_RECEIPT_INVALID');
    }
    receipts.set(receipt, kind);
    return receipt;
  }

  const eleven = (path: string, kind: ReceiptKind) => {
    serverOnly();
    return get(`${elevenOrigin}${path}`, { 'xi-api-key': credential(env.ELEVENLABS_API_KEY) }, kind);
  };
  const readPhone = (id = phoneNumberId) => {
    // The factory is scoped to a single approved provider phone, not arbitrary IDs.
    if (checkedId(id, /^[A-Za-z0-9][A-Za-z0-9_-]*$/) !== phoneNumberId) throw Error('OWNER_INBOUND_PROVIDER_TARGET_MISMATCH');
    return eleven(`/v1/convai/phone-numbers/${encodeURIComponent(id)}`, 'phone');
  };
  return Object.freeze({
    agent: () => eleven(`/v1/convai/agents/${encodeURIComponent(agentId)}?branch_id=${encodeURIComponent(branchId)}`, 'agent'),
    incomingAgent: () => eleven(`/v1/convai/agents/${encodeURIComponent(agentId)}`, 'agent'),
    branch: () => eleven(`/v1/convai/agents/${encodeURIComponent(agentId)}/branches/${encodeURIComponent(branchId)}`, 'branch'),
    phone: () => readPhone(),
    readPhone,
    twilio: (callSid: string) => {
      serverOnly();
      const id = checkedId(callSid, /^CA[0-9a-fA-F]{32}$/);
      if (env.TWILIO_ACCOUNT_SID !== accountSid) throw Error('OWNER_INBOUND_PROVIDER_ACCOUNT_MISMATCH');
      const token = credential(env.TWILIO_AUTH_TOKEN);
      return get(`${twilioOrigin}/2010-04-01/Accounts/${accountSid}/Calls/${id}.json`, {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${token}`).toString('base64')}`,
      }, 'twilio');
    },
    conversation: (conversationId: string) => {
      const id = checkedId(conversationId, /^conv_[A-Za-z0-9]+$/);
      return eleven(`/v1/convai/conversations/${encodeURIComponent(id)}`, 'conversation');
    },
    costs: (twilioInput: unknown, conversationInput: unknown): OwnerInboundProviderCosts => {
      serverOnly();
      const twilio = record(twilioInput), conversation = record(conversationInput);
      const result: OwnerInboundProviderCosts = {
        twilioCostMicros: null, elevenLabsCostMicros: null, totalCostMicros: null,
        currency: 'USD', twilioCostCents: null, elevenLabsCostCents: null, totalCostCents: null,
        definitive: false, scope: 'twilio_connectivity_and_elevenlabs_conversation', reason: 'unverified_receipts',
      };
      if (!twilio || !conversation || receipts.get(twilio) !== 'twilio' || receipts.get(conversation) !== 'conversation') return result;
      result.reason = 'cost_unknown';
      // Twilio represents a debit using a negative decimal string. A positive
      // amount is not silently converted into a charge. Zero is legitimate.
      if (twilio.status === 'completed' && twilio.price_unit === 'USD' && typeof twilio.price === 'string'
        && (/^-/.test(twilio.price) || /^0(?:\.0+)?$/.test(twilio.price))) {
        result.twilioCostMicros = usdMicros(twilio.price.replace(/^-/, ''));
      }
      const fiat = record(conversation.metadata)?.cost_fiat;
      // cost_fiat is documented USD. metadata.cost / charging.* are not a
      // substitute and never feed this calculation.
      if (conversation.status === 'done' && typeof fiat === 'number' && Number.isFinite(fiat) && fiat >= 0) {
        result.elevenLabsCostMicros = usdMicros(String(fiat));
      }
      result.twilioCostCents = exactWholeCents(result.twilioCostMicros);
      result.elevenLabsCostCents = exactWholeCents(result.elevenLabsCostMicros);
      if (result.twilioCostMicros !== null && result.elevenLabsCostMicros !== null) {
        const total = result.twilioCostMicros + result.elevenLabsCostMicros;
        if (Number.isSafeInteger(total)) {
          result.totalCostMicros = total;
          result.totalCostCents = exactWholeCents(total);
          result.definitive = true;
          result.reason = null;
        }
      }
      return result;
    },
  });
}
