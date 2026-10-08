import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { all, freshDb, one } from "./harness";

it("seed.sql creates a president and Mon/Wed/Fri practices with Skills + Games", async () => {
  const db = await freshDb();
  await db.exec(readFileSync(new URL("../../supabase/seed.sql", import.meta.url), "utf8"));

  expect(await one(db, "select role from board_members")).toEqual({ role: "president" });
  const days = await all<{ dow: number }>(db, "select distinct extract(dow from starts_at at time zone 'America/New_York')::int as dow from events order by 1");
  expect(days.map((d) => d.dow)).toEqual([1, 3, 5]);
  const lists = await all<{ name: string; cap: number; makes_teams: boolean }>(db, "select distinct name, cap, makes_teams from event_lists order by name");
  expect(lists).toEqual([
    { name: "Games", cap: 40, makes_teams: true },
    { name: "Skills", cap: 40, makes_teams: false },
  ]);
  // Opens at 9 AM New York the day before.
  const e = await one<{ opens: string; gap: number }>(
    db,
    `select to_char(opens_at at time zone 'America/New_York', 'HH24:MI') as opens,
            ((starts_at at time zone 'America/New_York')::date - (opens_at at time zone 'America/New_York')::date) as gap
       from events order by starts_at limit 1`,
  );
  expect(e).toEqual({ opens: "09:00", gap: 1 });
});
