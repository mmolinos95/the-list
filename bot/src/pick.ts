import { toLocalInputs, weekdayShort } from "../../src/lib/time";
import type { ListInfo, Practice } from "./data/types";

// Picking a practice from loose input: "thu", "thursday", "next", "today",
// "tomorrow", "10/23", "oct 23", "2026-10-23", or a slug. Dates and weekdays
// are New York dates (src/lib/time.ts), so a 9 PM practice is still "today".

const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};
const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Selector =
  | { kind: "next" }
  | { kind: "offset"; days: number }
  | { kind: "weekday"; day: number }
  | { kind: "monthDay"; month: number; day: number }
  | { kind: "date"; date: string }
  | { kind: "slug"; slug: string };

const MONTHS = "january february march april may june july august september october november december".split(" ");

/** "oct", "october", "sept" -> 10, 10, 9. At least three letters. */
function month(word: string) {
  if (word === "sept") return 9;
  if (word.length < 3) return null;
  const i = MONTHS.findIndex((m) => m.startsWith(word));
  return i >= 0 ? i + 1 : null;
}

/** Parses one selector, or null when the words aren't one. */
export function parseSelector(input: string): Selector | null {
  const s = input.trim().toLowerCase().replace(/[.,!?]+$/, "");
  if (!s) return null;
  if (s === "next" || s === "next practice" || s === "next one") return { kind: "next" };
  if (s === "today" || s === "tonight") return { kind: "offset", days: 0 };
  if (s === "tomorrow" || s === "tmrw" || s === "tmr") return { kind: "offset", days: 1 };
  const wd = s.replace(/^(next|this)\s+/, "");
  if (wd in WEEKDAYS) return { kind: "weekday", day: WEEKDAYS[wd] };
  let m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/);
  if (m) return valid(+m[1], +m[2]);
  m = s.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (m) return { kind: "date", date: m[1] };
  m = s.match(/^(\d{4}-\d{2}-\d{2})-[a-z]{3}(-\d+)?$/);
  if (m) return { kind: "slug", slug: s };
  m = s.match(/^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?$/);
  if (m && month(m[1])) return valid(month(m[1])!, +m[2]);
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)$/);
  if (m && month(m[2])) return valid(month(m[2])!, +m[1]);
  return null;
}

function valid(month: number, day: number): Selector | null {
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? { kind: "monthDay", month, day } : null;
}

/**
 * Splits "thu skills" into the selector "thu" and the rest "skills". Tries two
 * words first ("oct 23", "next thu"), then one. Returns null when the first
 * words aren't a selector.
 */
export function splitSelector(text: string): { selector: string; rest: string } | null {
  const words = text.trim().split(/\s+/).filter(Boolean);
  for (const n of [2, 1]) {
    if (words.length < n) continue;
    const head = words.slice(0, n).join(" ");
    if (parseSelector(head)) return { selector: head, rest: words.slice(n).join(" ") };
  }
  return null;
}

const nyDate = (iso: string) => toLocalInputs(iso).date;

function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The practice a selector means, from practices that haven't ended (soonest
 * first). "next" skips cancelled practices; the others don't, so asking about
 * a cancelled Thursday says it's cancelled.
 */
export function pickPractice(input: string, practices: Practice[], now: Date): Practice | null {
  const sel = parseSelector(input);
  if (!sel) return null;
  const live = practices.filter((p) => Date.parse(p.event.ends_at) > now.getTime()).sort((a, b) => a.event.starts_at.localeCompare(b.event.starts_at));
  switch (sel.kind) {
    case "next":
      return live.find((p) => !p.event.cancelled_at) ?? null;
    case "offset": {
      const date = addDays(nyDate(now.toISOString()), sel.days);
      return live.find((p) => nyDate(p.event.starts_at) === date) ?? null;
    }
    case "weekday":
      return live.find((p) => weekdayShort(p.event.starts_at) === SHORT[sel.day]) ?? null;
    case "monthDay":
      return live.find((p) => {
        const [, mm, dd] = nyDate(p.event.starts_at).split("-").map(Number);
        return mm === sel.month && dd === sel.day;
      }) ?? null;
    case "date":
      return live.find((p) => nyDate(p.event.starts_at) === sel.date) ?? null;
    case "slug":
      return live.find((p) => p.event.slug === sel.slug) ?? null;
  }
}

/**
 * Which lists of a practice the words name. "both"/"all" means every list.
 * Returns the lists found and whether any words were left unmatched.
 */
export function matchLists(text: string, lists: ListInfo[]): { lists: ListInfo[]; unknown: string | null } {
  const t = text.trim().toLowerCase();
  if (!t) return { lists: [], unknown: null };
  if (/^(both|all|every(thing)?|all lists)$/.test(t)) return { lists, unknown: null };
  const found = lists.filter((l) => new RegExp(`(^|[\\s,+&/])${escape(l.name.toLowerCase())}($|[\\s,+&/])`).test(t));
  let left = t;
  for (const l of found) left = left.replace(l.name.toLowerCase(), " ");
  left = left.replace(/\b(and|list|lists|the)\b|[,+&/]/g, " ").trim();
  return { lists: found, unknown: left || null };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A first-timer's `!in` text: their name, then any lists ("Ana Diaz", "Ana Diaz games",
 * "Ana Diaz both"). Text that is only lists has no name, and a name needs two words,
 * so "!in goalie" stays an unknown list.
 */
export function nameAndLists(text: string, lists: ListInfo[]): { name: string | null; lists: string } {
  const t = text.trim();
  if (!t || !matchLists(t, lists).unknown) return { name: null, lists: t };
  let words = t.split(/\s+/);
  let tail: string[] = [];
  const named = [...lists].sort((a, b) => b.name.length - a.name.length).find((l) => words.join(" ").toLowerCase().endsWith(` ${l.name.toLowerCase()}`));
  if (/^(both|all)$/i.test(words.at(-1)!)) tail = words.slice(-1);
  else if (named) tail = words.slice(-named.name.split(/\s+/).length);
  words = words.slice(0, words.length - tail.length);
  if (words.length < 2 || words.join(" ").length > 60) return { name: null, lists: t };
  return { name: tidyName(words.join(" ")), lists: tail.join(" ") };
}

/** "ana o'neil" → "Ana O'Neil"; a name typed with capitals stays as typed. */
const tidyName = (s: string) => (s === s.toLowerCase() ? s.replace(/(^|[\s'’-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase()) : s);
