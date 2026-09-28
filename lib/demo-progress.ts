export const DEMO_PROGRESS_KEY = "icash-demo-v1";
export type DemoProgress = { version: 1; count: number; limitConfirmed: boolean; savedAt: number };
export function readDemoProgress(): DemoProgress | null {
  try {
    const data = JSON.parse(localStorage.getItem(DEMO_PROGRESS_KEY) ?? "null");
    if (data?.version !== 1 || !Number.isInteger(data.count) || data.count < 1 || data.count > 14 || typeof data.limitConfirmed !== "boolean" || !Number.isFinite(data.savedAt) || data.savedAt > Date.now() || Date.now()-data.savedAt > 86400000) return null;
    if (data.count > 9 && !data.limitConfirmed) return null;
    return data;
  } catch { return null; }
}
export function saveDemoProgress(count: number, limitConfirmed: boolean) {
  try { localStorage.setItem(DEMO_PROGRESS_KEY,JSON.stringify({version:1,count,limitConfirmed,savedAt:Date.now()})); } catch { /* Demo remains usable without storage. */ }
}
