import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function verifyWebinarTimers(q, config) {
  const visitor = randomUUID(), other = randomUUID(), session = randomUUID(), preview = randomUUID();
  const timer = {id: 'pitch-timer', at: 30, mode: 'duration', durationSeconds: 600};
  const snapshot = {...config, timers: [timer, {...timer, id: 'fixed', mode: 'deadline'}], recordingVersion: 'day'};
  await q('insert into icash_webinar_visitors(id) values($1),($2)', [visitor, other]);
  await q('insert into icash_webinar_sessions(id,visitor_id,webinar_id,revision,config,is_preview) values($1,$2,$3,1,$4,false),($5,$2,$3,1,$4,true)', [session, visitor, config.id, snapshot, preview]);
  const read = async (id = session, seconds = 30, viewer = visitor) => (await q('select icash_webinar_timers($1,$2,$3) as result', [viewer, id, seconds])).rows[0].result;
  assert.deepEqual((await read(session, 29)).deadlines, {});
  assert.deepEqual((await read(preview)).deadlines, {});
  await assert.rejects(() => read(session, 30, other));
  await assert.rejects(() => read(session, -1));
  const first = await read();
  assert.deepEqual(Object.keys(first.deadlines), ['pitch-timer']);
  const deadline = Date.parse(first.deadlines['pitch-timer']);
  assert.ok(deadline - first.serverNow > 599000 && deadline - first.serverNow <= 600000);
  const tabs = await Promise.all([read(), read()]);
  assert.ok(tabs.every(result => result.deadlines['pitch-timer'] === first.deadlines['pitch-timer']), 'Two tabs keep the first deadline');
  const returned = randomUUID(), night = randomUUID();
  await q('insert into icash_webinar_sessions(id,visitor_id,webinar_id,revision,config) values($1,$2,$3,2,$4),($5,$2,$3,3,$6)', [returned, visitor, config.id, {...snapshot, revision: 2, timers: [{...timer, durationSeconds: 999}]}, night, {...snapshot, revision: 3, recordingVersion: 'night'}]);
  assert.equal((await read(returned)).deadlines['pitch-timer'], first.deadlines['pitch-timer'], 'An edited duration or new session cannot extend the saved timer');
  await read(night);
  assert.equal((await q('select count(*)::int as n from icash_webinar_timer_deadlines where visitor_id=$1', [visitor])).rows[0].n, 2, 'Day and Night deadlines are independent');
  await q("update icash_webinar_timer_deadlines set started_at=now()-interval '11 minutes',ends_at=now()-interval '1 minute' where visitor_id=$1 and recording_version='day'", [visitor]);
  const expired = await read();
  assert.ok(Date.parse(expired.deadlines['pitch-timer']) < expired.serverNow, 'An expired timer never restarts');
  assert.equal((await read(returned)).deadlines['pitch-timer'], expired.deadlines['pitch-timer']);
  for (const role of ['anon', 'authenticated']) {
    assert.equal((await q("select has_function_privilege($1,'icash_webinar_timers(uuid,uuid,integer)','execute') as ok", [role])).rows[0].ok, false);
    assert.equal((await q("select has_table_privilege($1,'icash_webinar_timer_deadlines','select') as ok", [role])).rows[0].ok, false);
  }
  await q("set role service_role");
  assert.equal((await read()).deadlines['pitch-timer'], expired.deadlines['pitch-timer']);
  await q('reset role');
  console.log('Webinar timer database checks passed: first reveal, returns, concurrent calls, revision edits, expiry, Day/Night isolation, previews and access control.');
}
