import {z} from 'zod';
import {db} from '@/lib/stripe-test';
import {timerResponseSchema} from '@/lib/webinar-timers';
import {webinarBody, webinarError, webinarHeaders, webinarLimit, webinarOrigin, webinarSession} from '@/lib/webinar-server';

export async function POST(req: Request) {
  try {
    webinarOrigin(req);
    const input = z.object({sessionId: z.string().uuid(), seconds: z.number().int().min(0).max(14400)}).strict().parse(await webinarBody(req, 1000));
    const {v, s} = await webinarSession(input.sessionId);
    await webinarLimit(req, v.id, 'timers', 30, 60);
    if (s.is_preview || s.superseded_at) return Response.json({deadlines: {}, serverNow: Date.now()}, {headers: webinarHeaders});
    const result = timerResponseSchema.parse(await db('rpc/icash_webinar_timers', 'POST', {p_visitor: v.id, p_session: s.id, p_seconds: input.seconds}));
    return Response.json(result, {headers: webinarHeaders});
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({error: 'The timer request could not be read.'}, {status: 400, headers: webinarHeaders});
    return webinarError(error);
  }
}
