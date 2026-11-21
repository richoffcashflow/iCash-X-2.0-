import {db} from '@/lib/stripe-test';

export const secondWebinarPixel = '1189620056677378';
const secondWebinarCodes = new Set(['100007', '100008']);
const secondWebinarIds = new Set([
  '12079dd6-daa2-4773-b193-a1aee8c3061e',
  '0c0be7cd-c1c6-40e5-a8bd-2a47f30704d4'
]);

export async function secondPixelSessions(sessionIds:(string|null|undefined)[]) {
  const ids = [...new Set(sessionIds.filter((id):id is string => !!id && /^[a-f0-9-]{36}$/i.test(id)))];
  if (!ids.length) return new Set<string>();
  const rows = await db<{id:string;webinar_id:string}[]>(
    'icash_webinar_sessions?id=in.(' + ids.join(',') + ')&select=id,webinar_id'
  );
  return new Set(rows.filter(row => secondWebinarIds.has(row.webinar_id)).map(row => row.id));
}

export async function webinarRequestPixel(req:Request, original:string) {
  const url = new URL(req.url);
  const page = new URL(url.searchParams.get('page') || '/', url.origin);
  if (page.origin !== url.origin) return original;
  const code = page.pathname.match(/^\/live\/(\d+)\/?$/)?.[1];
  if (code) return secondWebinarCodes.has(code) ? secondWebinarPixel : original;
  if (page.pathname === '/webinar') return original;
  const session = page.searchParams.get('webinar_session');
  if (session) return (await secondPixelSessions([session])).has(session) ? secondWebinarPixel : original;
  return secondWebinarCodes.has(req.headers.get('x-icash-webinar-code') || '') ? secondWebinarPixel : original;
}
