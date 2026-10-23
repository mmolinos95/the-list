import { freshDb, type Db } from "../../tests/db/harness";
import type { Chat, IncomingMessage } from "../src/chat";
import { Commands, type CommandDeps } from "../src/commands";
import { FEATURES, type Feature } from "../src/config";
import { sqlData } from "../src/data/sql";
import type { Data } from "../src/data/types";
import type { Asker } from "../src/identity";
import type { Mail, Mailer } from "../src/mailer";
import { LocalState } from "../src/state";

export { freshDb, type Db };

export function dataFor(db: Db): Data {
  return sqlData(async (sql, params) => (await db.query<Record<string, unknown>>(sql, params)).rows);
}

/**
 * A practice relative to now, like tests/db/harness.ts makeEvent, but with
 * list times and a real-style slug (2026-10-23-fri, -2, ...) that `!list` accepts,
 * so tests can name their own practice. Defaults: open, starts in a day, one list.
 */
export async function practice(
  db: Db,
  opts: {
    startsIn?: string;
    opensIn?: string | null;
    title?: string;
    lists?: { name: string; cap: number; teams?: boolean; offset?: string }[];
    startsAt?: string;
  } = {},
) {
  const opensIn = opts.opensIn === undefined ? "-1 hour" : opts.opensIn;
  const lists = opts.lists ?? [{ name: "Games", cap: 40 }];
  const start = opts.startsAt ? `$1::timestamptz` : `now() + $1::interval`;
  const ev = (
    await db.query<{ id: string; slug: string; starts_at: string }>(
      `insert into events (title, location, slug, starts_at, ends_at, opens_at, locks_at)
       values ($3, 'Riverside Park',
               _unique_slug(to_char((${start}) at time zone 'America/New_York', 'YYYY-MM-DD') || '-' || lower(to_char((${start}) at time zone 'America/New_York', 'Dy'))),
               ${start}, ${start} + interval '2 hours',
               case when $2::text is null then null else now() + $2::interval end, now())
       returning id, slug, starts_at`,
      [opts.startsAt ?? opts.startsIn ?? "1 day", opensIn, opts.title ?? "Thursday practice"],
    )
  ).rows[0];
  const ids: Record<string, string> = {};
  for (const [i, l] of lists.entries()) {
    const row = (
      await db.query<{ id: string }>(
        `insert into event_lists (event_id, name, cap, makes_teams, position, starts_at, ends_at)
         select $1, $2, $3, $4, $5, e.starts_at + $6::interval, e.starts_at + $6::interval + interval '1 hour' from events e where e.id = $1
         returning id`,
        [ev.id, l.name, l.cap, l.teams ?? false, i, l.offset ?? `${i} hours`],
      )
    ).rows[0];
    ids[l.name] = row.id;
  }
  return { id: ev.id, slug: ev.slug, lists: ids };
}

export async function member(db: Db, email: string, name: string, phone: string | null = null) {
  return (await db.query<{ id: string }>(`insert into members (email, name, phone) values ($1, $2, $3) returning id`, [email, name, phone])).rows[0].id;
}

export async function board(db: Db, email: string, name = "Board Person") {
  return (await db.query<{ id: string }>(`insert into board_members (email, name, role) values ($1, $2, 'president') returning id`, [email, name])).rows[0].id;
}

export function commandsFor(data: Data, features: Feature[] = [...FEATURES], extra: Partial<CommandDeps> = {}) {
  return new Commands({
    data,
    features: new Set(features),
    botPhone: "+12125550100",
    siteUrl: "https://list.example",
    dropLinkSecret: "test-secret",
    now: () => new Date(),
    ...extra,
  });
}

export async function askerOf(data: Data, email: string): Promise<Asker> {
  const [m, b] = await Promise.all([data.memberByEmail(email), data.boardMember(email)]);
  return { email, name: m?.name ?? null, phone: m?.phone ?? null, member: m, board: b };
}

export class FakeChat implements Chat {
  out: { id: string; chatId: string; text: string; quotedId?: string; mentions?: string[] }[] = [];
  deleted: string[] = [];
  typingLog: string[] = [];
  private n = 0;
  async reply(to: IncomingMessage, text: string, mentions?: string[]) {
    const id = `sent${++this.n}`;
    this.out.push({ id, chatId: to.chatId, text, quotedId: to.id, ...(mentions ? { mentions } : {}) });
    return id;
  }
  async send(chatId: string, text: string, mentions?: string[]) {
    const id = `sent${++this.n}`;
    this.out.push({ id, chatId, text, ...(mentions ? { mentions } : {}) });
    return id;
  }
  async delete(_chatId: string, msgId: string) {
    this.deleted.push(msgId);
  }
  async typing(chatId: string, on: boolean) {
    this.typingLog.push(`${chatId}:${on ? "on" : "off"}`);
  }
}

export class FakeMailer implements Mailer {
  sent: Mail[] = [];
  async send(m: Mail) {
    this.sent.push(m);
  }
  lastCode() {
    return this.sent.at(-1)?.subject.match(/(\d{6})/)?.[1] ?? null;
  }
}

export const memoryState = (now?: () => number) => new LocalState(":memory:", now);

let n = 0;
export function msg(over: Partial<IncomingMessage> = {}): IncomingMessage {
  n++;
  return {
    id: `m${n}`,
    chatId: "120363000000000001@g.us",
    isGroup: true,
    groupName: "CBS FC",
    senderIds: ["111111111111111@lid"],
    senderPhone: null,
    text: "!list",
    mentionsBot: false,
    timestamp: Math.floor(Date.now() / 1000),
    ...over,
  };
}
