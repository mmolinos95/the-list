// All times are stored in UTC and shown in New York time.

export const TIME_ZONE = "America/New_York";

function fmt(iso: string | Date, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, ...options }).format(new Date(iso));
}

/** "Wednesday" */
export const weekdayLong = (iso: string | Date) => fmt(iso, { weekday: "long" });
/** "Wed" */
export const weekdayShort = (iso: string | Date) => fmt(iso, { weekday: "short" });
/** "Oct 8" */
export const monthDay = (iso: string | Date) => fmt(iso, { month: "short", day: "numeric" });
/** "Wed, Oct 8" */
export const dayDate = (iso: string | Date) => fmt(iso, { weekday: "short", month: "short", day: "numeric" });

/** "12:30 PM", or "12 PM" on the hour. */
export function clock(iso: string | Date) {
  const s = fmt(iso, { hour: "numeric", minute: "2-digit" });
  return s.replace(":00", "");
}

/** "12:30–2 PM" (drops the first AM/PM when both match). */
export function timeRange(startIso: string, endIso: string) {
  const a = clock(startIso);
  const b = clock(endIso);
  const [aTime, aMer] = a.split(" ");
  const [, bMer] = b.split(" ");
  return aMer === bMer ? `${aTime}–${b}` : `${a}–${b}`;
}

/** "Tue at 9 AM" when within a week, otherwise "Oct 14 at 9 AM". */
export function relativeDay(iso: string, now = new Date()) {
  const days = (new Date(iso).getTime() - now.getTime()) / 86_400_000;
  const day = days < 6 ? weekdayShort(iso) : monthDay(iso);
  return `${day} at ${clock(iso)}`;
}

/** "1h 10m", "45m", "2d 3h" */
export function duration(ms: number) {
  const mins = Math.max(0, Math.round(ms / 60_000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return m ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

/** The New York calendar date + time as inputs for <input type="date|time">. */
export function toLocalInputs(iso: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** Converts a New York local date ("2026-10-08") + time ("12:30") to a UTC ISO string. */
export function fromLocalInputs(date: string, time: string) {
  // Guess as if UTC, then correct by New York's offset at that moment (handles daylight saving).
  const guess = new Date(`${date}T${time}:00Z`);
  const local = toLocalInputs(guess.toISOString());
  const asIfUtc = new Date(`${local.date}T${local.time}:00Z`);
  const offset = asIfUtc.getTime() - guess.getTime();
  return new Date(guess.getTime() - offset).toISOString();
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "12:30:00" (Postgres time) -> "12:30 PM" */
export function timeOfDay(t: string) {
  const [h, m] = t.split(":").map(Number);
  const mer = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, "0")} ${mer}` : `${h12} ${mer}`;
}
