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
      first(`select id, email, name, phone from members where phone = $1 order by (email is not null) desc, updated_at desc limit 1`, [phone]),
    membersById: async (ids) => (ids.length ? ((await q(`select id, email, name, phone from members where id = any ($1::uuid[])`, [ids])) as never) : []),
    boardMember: (email) => first(`select id, email, name, role from board_members where email = $1`, [email.trim().toLowerCase()]),

    signUp: (eventId, listIds, name, email, phone) =>
      value(`select sign_up($1, $2::uuid[], $3, $4, $5) as v`, [eventId, listIds, name, email, phone]),
    signUpByPhone: (eventId, listIds, name, phone) => value(`select sign_up_by_phone($1, $2::uuid[], $3, $4) as v`, [eventId, listIds, name, phone]),
    drop: (eventId, memberId, listIds) => value(`select drop_signups($1, $2, $3::uuid[]) as v`, [eventId, memberId, listIds]),
    async openEvent(eventId) {
      await q(`select open_event($1)`, [eventId]);
    },
    cancelEvent: (eventId, reason, by) => value(`select cancel_event($1, $2, $3) as v`, [eventId, reason, by]),
    addSignup: (listId, name, spot, by) => value(`select add_signup($1, $2, null, null, $3::spot_kind, $4) as v`, [listId, name, spot, by]),
    removeSignup: (signupId, by) => value(`select remove_signup($1, $2) as v`, [signupId, by]),
    async shuffleTeams(eventId) {
      await q(`select shuffle_teams($1)`, [eventId]);
    },
    async deleteMember(memberId) {
      await q(`delete from members where id = $1`, [memberId]);
    },

    // Timestamps as text, to keep Postgres' microseconds (a JS Date drops them).
    lastSignupAt: async (memberId) => (await first<{ v: string }>(`select last_signup_at::text as v from members where id = $1`, [memberId]))?.v ?? null,
    lastDroppedAt: async (eventId, memberId) =>
      (
        await first<{ v: string | null }>(
          `select max(s.dropped_at)::text as v from signups s join event_lists l on l.id = s.list_id
            where l.event_id = $1 and s.member_id = $2 and s.status = 'dropped'`,
          [eventId, memberId],
        )
      )?.v ?? null,
    cancelledAt: async (eventId) => (await first<{ v: string | null }>(`select cancelled_at::text as v from events where id = $1`, [eventId]))?.v ?? null,
    addedAt: async (signupId) =>
      (await first<{ v: string }>(`select m.created_at::text as v from signups s join members m on m.id = s.member_id where s.id = $1`, [signupId]))?.v ?? null,
    removedAt: async (signupId) => (await first<{ v: string | null }>(`select removed_at::text as v from signups where id = $1`, [signupId]))?.v ?? null,
    async takeEmails({ eventId, kind, at, memberIds }) {
      if (memberIds && memberIds.length === 0) return [];
      const who = memberIds ? `member_id = any ($4::uuid[])` : `member_id is null`;
      return (await q(
        `delete from emails where event_id = $1 and kind = $2::email_kind and created_at = $3::timestamptz and status <> 'sent' and ${who}
         returning id, kind, to_address, member_id, event_id, payload`,
        memberIds ? [eventId, kind, at, memberIds] : [eventId, kind, at],
      )) as never;
    },
  };
}
