import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

// Local state on the bot's machine (never in the repo): which WhatsApp IDs
// belong to which member, the linking flow in progress, and how many codes
// each WhatsApp ID was sent. It holds personal data, so it lives only on the VM.

/** Who a WhatsApp ID belongs to: by email (linked by DM), or with email null for
 * members known only by their WhatsApp phone. name/phone are kept so a member deleted
 * by the 12-month cleanup, or a new member who hasn't signed up yet, can still sign up. */
export type Link = { email: string | null; name: string | null; phone: string | null };

export type Flow =
  | { step: "email" }
  | { step: "code"; email: string; codeHash: string; expiresAt: number; tries: number }
  | { step: "name"; email: string }

export class LocalState {
  private db: DatabaseSync;

  constructor(
    path: string,
    private now: () => number = Date.now,
  ) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      create table if not exists links (
        wa_id text primary key, email text, name text, phone text, linked_at integer not null);
      create table if not exists flows (wa_id text primary key, data text not null, updated_at integer not null);
      create table if not exists code_sends (wa_id text not null, sent_at integer not null);
      create index if not exists code_sends_wa on code_sends (wa_id, sent_at);
      create table if not exists alert_sends (kind text primary key, sent_at integer not null);
      create table if not exists list_posts (
        chat_id text not null, event_id text not null, msg_id text not null, primary key (chat_id, event_id));
    `);
    // Links used to need an email; members known by phone have none.
    const email = (this.db.prepare(`pragma table_info(links)`).all() as { name: string; notnull: number }[]).find((c) => c.name === "email");
    if (email?.notnull)
      this.db.exec(`
        begin;
        alter table links rename to links_old;
        create table links (wa_id text primary key, email text, name text, phone text, linked_at integer not null);
        insert into links select wa_id, email, name, phone, linked_at from links_old;
        drop table links_old;
        commit;
      `);
  }

  link(waIds: string[]): Link | null {
    for (const id of waIds) {
      const row = this.db.prepare(`select email, name, phone from links where wa_id = ?`).get(id) as Link | undefined;
      if (row) return { email: row.email, name: row.name ?? null, phone: row.phone ?? null };
    }
    return null;
  }

  saveLink(waIds: string[], link: Link) {
    const stmt = this.db.prepare(
      `insert into links (wa_id, email, name, phone, linked_at) values (?, ?, ?, ?, ?)
       on conflict (wa_id) do update set email = excluded.email, name = excluded.name, phone = excluded.phone, linked_at = excluded.linked_at`,
    );
    for (const id of new Set(waIds)) stmt.run(id, link.email?.toLowerCase() ?? null, link.name, link.phone, this.now());
  }

  /** The WhatsApp ID to @mention for a member (by email, else phone): their hidden ID (@lid) if known, else their phone JID. */
  mentionFor(who: { email: string | null; phone: string | null }): string | null {
    const by = (col: "email" | "phone", value: string) =>
      (this.db.prepare(`select wa_id from links where ${col} = ? order by linked_at desc`).all(value) as { wa_id: string }[]).map((r) => r.wa_id);
    let ids = who.email ? by("email", who.email.toLowerCase()) : [];
    if (ids.length === 0 && who.phone) ids = by("phone", who.phone);
    return ids.find((id) => id.endsWith("@lid")) ?? ids.find((id) => id.endsWith("@s.whatsapp.net")) ?? null;
  }

  flow(waId: string): Flow | null {
    const row = this.db.prepare(`select data, updated_at from flows where wa_id = ?`).get(waId) as { data: string; updated_at: number } | undefined;
    // A flow left alone for a day is forgotten.
    if (!row || this.now() - row.updated_at > 86_400_000) return null;
    return JSON.parse(row.data) as Flow;
  }

  setFlow(waId: string, flow: Flow) {
    this.db
      .prepare(`insert into flows (wa_id, data, updated_at) values (?, ?, ?) on conflict (wa_id) do update set data = excluded.data, updated_at = excluded.updated_at`)
      .run(waId, JSON.stringify(flow), this.now());
  }

  clearFlow(waId: string) {
    this.db.prepare(`delete from flows where wa_id = ?`).run(waId);
  }

  codesSentSince(waId: string, sinceMs: number) {
    const row = this.db.prepare(`select count(*) as n from code_sends where wa_id = ? and sent_at >= ?`).get(waId, sinceMs) as { n: number };
    return Number(row.n);
  }

  recordCodeSent(waId: string) {
    this.db.prepare(`delete from code_sends where sent_at < ?`).run(this.now() - 86_400_000);
    this.db.prepare(`insert into code_sends (wa_id, sent_at) values (?, ?)`).run(waId, this.now());
  }

  /** Swaps in the bot's newest list message for a practice in a chat; returns the one it replaces. */
  swapListPost(chatId: string, eventId: string, msgId: string): string | null {
    const row = this.db.prepare(`select msg_id from list_posts where chat_id = ? and event_id = ?`).get(chatId, eventId) as { msg_id: string } | undefined;
    this.db
      .prepare(`insert into list_posts (chat_id, event_id, msg_id) values (?, ?, ?) on conflict (chat_id, event_id) do update set msg_id = excluded.msg_id`)
      .run(chatId, eventId, msgId);
    return row && row.msg_id !== msgId ? row.msg_id : null;
  }

  /** When an alert of this kind was last emailed (alerts.ts). */
  lastAlert(kind: string): number | null {
    const row = this.db.prepare(`select sent_at from alert_sends where kind = ?`).get(kind) as { sent_at: number } | undefined;
    return row ? Number(row.sent_at) : null;
  }

  markAlert(kind: string, at: number) {
    this.db.prepare(`insert into alert_sends (kind, sent_at) values (?, ?) on conflict (kind) do update set sent_at = excluded.sent_at`).run(kind, at);
  }

  close() {
    this.db.close();
  }
}

export const hashCode = (waId: string, code: string) => createHash("sha256").update(`${waId}:${code}`).digest("hex");
