import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

// Local state on the bot's machine (never in the repo): which WhatsApp IDs
// belong to which member, the linking flow in progress, and how many codes
// each WhatsApp ID was sent. It holds personal data, so it lives only on the VM.

/** Who a WhatsApp ID belongs to. name/phone are kept so a member deleted by the
 * 12-month cleanup, or a new member who hasn't signed up yet, can still sign up. */
export type Link = { email: string; name: string | null; phone: string | null };

export type Flow =
  | { step: "email" }
  | { step: "code"; email: string; codeHash: string; expiresAt: number; tries: number }
  | { step: "name"; email: string }
  | { step: "phone"; email: string; name: string };

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
        wa_id text primary key, email text not null, name text, phone text, linked_at integer not null);
      create table if not exists flows (wa_id text primary key, data text not null, updated_at integer not null);
      create table if not exists code_sends (wa_id text not null, sent_at integer not null);
      create index if not exists code_sends_wa on code_sends (wa_id, sent_at);
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
    for (const id of new Set(waIds)) stmt.run(id, link.email.toLowerCase(), link.name, link.phone, this.now());
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

  close() {
    this.db.close();
  }
}

export const hashCode = (waId: string, code: string) => createHash("sha256").update(`${waId}:${code}`).digest("hex");
