import { shapePractice, type Data, type RawEvent } from "./types";

// Data over plain SQL. Used by the tests with PGlite and the real migrations,
// so the bot's calls are checked against the real database functions.

export type Query = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const EVENT_JSON = `
  jsonb_build_object(
    'id', e.id, 'template_id', e.template_id, 'title', e.title, 'location', e.location, 'slug', e.slug,
    'starts_at', e.starts_at, 'ends_at', e.ends_at, 'opens_at', e.opens_at, 'locks_at', e.locks_at,
    'edited_at', e.edited_at, 'cancelled_at', e.cancelled_at, 'cancel_reason', e.cancel_reason,
    'event_lists', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'event_id', l.event_id, 'name', l.name, 'cap', l.cap, 'makes_teams', l.makes_teams,
        'position', l.position, 'starts_at', l.starts_at, 'ends_at', l.ends_at, 'teams_sent_at', l.teams_sent_at,
        'signups', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', s.id, 'member_id', s.member_id, 'spot', s.spot, 'status', s.status, 'created_at', s.created_at,
            'promoted_at', s.promoted_at, 'team', s.team, 'team_sent', s.team_sent,
            'members', jsonb_build_object('name', m.name)))
          from signups s join members m on m.id = s.member_id where s.list_id = l.id), '[]'::jsonb)))
      from event_lists l where l.event_id = e.id), '[]'::jsonb)) as r`;

export function sqlData(q: Query): Data {
  const first = async <T>(sql: string, params: unknown[] = []) => ((await q(sql, params))[0] ?? null) as T | null;
  const value = async <T>(sql: string, params: unknown[] = []) => (await first<{ v: T }>(sql, params))!.v;

  return {
    async upcoming(now, days = 14) {
      const rows = await q(`select ${EVENT_JSON} from events e where e.ends_at > $1 and e.starts_at < $2 order by e.starts_at`, [
        now.toISOString(),
        new Date(now.getTime() + days * 86_400_000).toISOString(),
      ]);
      return rows.map((row) => shapePractice(row.r as RawEvent, now));
    },
    async practice(eventId, now) {
      const row = await first<{ r: RawEvent }>(`select ${EVENT_JSON} from events e where e.id = $1`, [eventId]);
      return row ? shapePractice(row.r, now) : null;
    },
    memberByEmail: (email) => first(`select id, email, name, phone from members where email = $1`, [email.trim().toLowerCase()]),
    memberByPhone: (phone) =>
      first(`select id, email, name, phone from members where phone = $1 and email is not null order by updated_at desc limit 1`, [phone]),
    boardMember: (email) => first(`select id, email, name, role from board_members where email = $1`, [email.trim().toLowerCase()]),

    signUp: (eventId, listIds, name, email, phone) =>
      value(`select sign_up($1, $2::uuid[], $3, $4, $5) as v`, [eventId, listIds, name, email, phone]),
    drop: (eventId, memberId, listIds) => value(`select drop_signups($1, $2, $3::uuid[]) as v`, [eventId, memberId, listIds]),
    async openEvent(eventId) {
      await q(`select open_event($1)`, [eventId]);
    },
    cancelEvent: (eventId, reason, by) => value(`select cancel_event($1, $2, $3) as v`, [eventId, reason, by]),
    addSignup: (listId, name, spot, by) => value(`select add_signup($1, $2, null, null, $3::spot_kind, $4) as v`, [listId, name, spot, by]),
    async shuffleTeams(eventId) {
      await q(`select shuffle_teams($1)`, [eventId]);
    },

    sentSince: async (iso) => Number(await value(`select count(*)::int as v from emails where status = 'sent' and sent_at >= $1`, [iso])),
    claimEmails: async (limit) =>
      (await q(`select id, kind, to_address, member_id, event_id, payload from claim_emails($1)`, [limit])) as never,
    async markSent(id) {
      await q(`update emails set status = 'sent', sent_at = now(), last_error = null where id = $1`, [id]);
    },
    async markFailed(id, error) {
      await q(`update emails set status = 'failed', last_error = $2, claimed_at = null where id = $1`, [id, error.slice(0, 500)]);
    },
  };
}
