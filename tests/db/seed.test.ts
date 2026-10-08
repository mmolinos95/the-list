import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { all, freshDb, one } from "./harness";

it("seed.sql creates a president and the real Mon/Wed/Fri schedule", async () => {
  const db = await freshDb();
  await db.exec(readFileSync(new URL("../../supabase/seed.sql", import.meta.url), "utf8"));

  expect(await one(db, "select role from board_members")).toEqual({ role: "president" });
  const local = (col: string) => `to_char(${col} at time zone 'America/New_York', 'HH24:MI')`;
  const lists = await all(
    db,
    `select distinct extract(dow from l.starts_at at time zone 'America/New_York')::int as dow, l.name, l.cap, l.makes_teams,
            ${local("l.starts_at")} as start, ${local("l.ends_at")} as end, e.location
       from event_lists l join events e on e.id = l.event_id order by 1, 5`,
  );
  const place = "Riverside Park (107th) entrance at 103rd St";
  expect(lists).toEqual([
    { dow: 1, name: "Games", cap: 40, makes_teams: true, start: "12:40", end: "13:40", location: place },
    { dow: 3, name: "Games", cap: 40, makes_teams: true, start: "12:40", end: "13:40", location: place },
    { dow: 5, name: "Skills", cap: 40, makes_teams: false, start: "10:00", end: "11:00", location: place },
    { dow: 5, name: "Games", cap: 40, makes_teams: true, start: "11:00", end: "12:00", location: place },
  ]);
  // Opens at 9 AM New York the day before.
  const e = await one<{ opens: string; gap: number }>(
    db,
    `select ${local("opens_at")} as opens,
            ((starts_at at time zone 'America/New_York')::date - (opens_at at time zone 'America/New_York')::date) as gap
       from events order by starts_at limit 1`,
  );
  expect(e).toEqual({ opens: "09:00", gap: 1 });
});
