import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = join(__dirname, "../../supabase/migrations");

/** A fresh in-memory Postgres with the app's migrations applied. */
export async function freshDb() {
  const db = new PGlite();
  // Minimal stand-in for Supabase's auth schema.
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  `);
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }
  return db;
}

export type Db = Awaited<ReturnType<typeof freshDb>>;

export async function one<T = Record<string, unknown>>(db: Db, sql: string, params: unknown[] = []) {
  const res = await db.query<T>(sql, params);
  return res.rows[0];
}

export async function all<T = Record<string, unknown>>(db: Db, sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows;
}

/**
 * Creates a practice relative to now. Defaults: opened an hour ago,
 * starts in 1 day (so not locked), one list "Games" with cap 40.
 */
export async function makeEvent(
  db: Db,
  opts: { opensIn?: string | null; startsIn?: string; lists?: { name: string; cap: number; teams?: boolean }[] } = {},
) {
  const opensIn = opts.opensIn === undefined ? "-1 hour" : opts.opensIn;
  const startsIn = opts.startsIn ?? "1 day";
  const lists = opts.lists ?? [{ name: "Games", cap: 40 }];
  const ev = await one<{ id: string }>(
    db,
    `insert into events (title, location, slug, starts_at, ends_at, opens_at, locks_at)
     values ('Wednesday practice', 'Riverside Park', 'test-' || gen_random_uuid(),
             now() + $1::interval, now() + $1::interval + interval '90 minutes',
             case when $2::text is null then null else now() + $2::interval end, now())
     returning id`,
    [startsIn, opensIn],
  );
  const listIds: Record<string, string> = {};
  for (const [i, l] of lists.entries()) {
    const row = await one<{ id: string }>(
      db,
      `insert into event_lists (event_id, name, cap, makes_teams, position) values ($1, $2, $3, $4, $5) returning id`,
      [ev.id, l.name, l.cap, l.teams ?? false, i],
    );
    listIds[l.name] = row.id;
  }
  return { id: ev.id, lists: listIds };
}

export type SignUpResult = {
  member_id: string;
  created: boolean;
  results: { list_id: string; list: string; spot: "main" | "waitlist"; position: number; cap: number; already: boolean }[];
};

export async function signUp(db: Db, eventId: string, listIds: string[], name: string, email: string, phone = "+12125550100") {
  const row = await one<{ r: SignUpResult }>(db, `select sign_up($1, $2::uuid[], $3, $4, $5) as r`, [
    eventId,
    listIds,
    name,
    email,
    phone,
  ]);
  // PGlite's clock only ticks every millisecond (real Postgres: every microsecond),
  // so back-to-back sign-ups could tie on created_at and the waitlist order would
  // fall back to the random id. Wait for the next tick, like real people would.
  await new Promise((r) => setTimeout(r, 2));
  return row.r;
}

export async function addBoard(db: Db, email: string, role: "president" | "board" = "board") {
  return (await one<{ id: string }>(db, `insert into board_members (email, name, role) values ($1, $1, $2) returning id`, [email, role])).id;
}
