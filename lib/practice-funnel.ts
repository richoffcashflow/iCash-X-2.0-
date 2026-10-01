/** Local simulation choices, never account credits, payment consent, or live authority. */
export type PracticeBudget = {code: string; priceCents: number};
export type PracticeSelection = {version: 1; setupId: string; code: string; screen: 'demo' | 'funding'; savedAt: number};
const selectionKey = 'icash-practice-selection-v1';
export function practiceBudgets(value: unknown): PracticeBudget[] {
  if (!value || typeof value !== 'object') throw Error('Could not verify budget options.');
  const data = value as {mode?: unknown; packs?: unknown};
  if (!['live', 'test', null].includes(data.mode as string | null) || !Array.isArray(data.packs)) throw Error('Could not verify budget options.');
  const seen = new Set<string>();
  return data.packs.flatMap((pack: unknown): PracticeBudget[] => {
    if (!pack || typeof pack !== 'object') return [];
    const p = pack as {code?: unknown; price_cents?: unknown; enabled?: unknown};
    if (typeof p.code !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(p.code) || seen.has(p.code) ||
        !Number.isSafeInteger(p.price_cents) || (p.price_cents as number) < 1000 || (p.price_cents as number) > 100000 ||
        typeof p.enabled !== 'boolean' || (data.mode === 'live' && !p.enabled)) return [];
    seen.add(p.code);
    return [{code: p.code, priceCents: p.price_cents as number}];
  }).sort((a, b) => a.priceCents - b.priceCents);
}
export function readPracticeSelection(setupId: string): PracticeSelection | null {
  try {
    const data = JSON.parse(localStorage.getItem(selectionKey) ?? 'null');
    if (data?.version !== 1 || data.setupId !== setupId || typeof data.code !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,80}$/.test(data.code) || !['demo', 'funding'].includes(data.screen) ||
        !Number.isFinite(data.savedAt) || data.savedAt > Date.now() || Date.now() - data.savedAt > 30 * 86400000) return null;
    return data;
  } catch {return null;}
}
export function savePracticeSelection(setupId: string, code: string, screen: 'demo' | 'funding') {
  try {localStorage.setItem(selectionKey, JSON.stringify({version: 1, setupId, code, screen, savedAt: Date.now()}));} catch { /* The funnel remains usable when browser storage is blocked. */ }
}
export function practiceScope(setupId: string, code: string) {return `${setupId}:${code}`;}
