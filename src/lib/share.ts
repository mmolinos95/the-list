import "server-only";
import { signupUrl } from "./signup-link";
import { toLocalInputs, weekdayLong } from "./time";
import type { EventList, EventRow } from "./types";

// What the board pastes into WhatsApp, in the format the club already uses:
//
//   List Sign Up: 10/9 Friday Practice
//   Skills: 10:00 - 11:00 (40 players)
//   Games: 11:00 - 12:00 (40 players)
//   Location: Riverside Park (107th) entrance at 103rd St
//   Sign up: https://…/p/2026-10-09-fri?k=…

export type Share = { url: string; post: string };

const hm = (iso: string) => toLocalInputs(iso).time;

export function shareFor(event: EventRow, lists: Pick<EventList, "name" | "cap" | "starts_at" | "ends_at">[]): Share {
  const { date } = toLocalInputs(event.starts_at);
  const [, month, day] = date.split("-").map(Number);
  const url = signupUrl(event);
  const post = [
    `List Sign Up: ${month}/${day} ${weekdayLong(event.starts_at)} Practice`,
    ...lists.map((l) => `${l.name}: ${hm(l.starts_at)} - ${hm(l.ends_at)} (${l.cap} players)`),
    `Location: ${event.location}`,
    `Sign up: ${url}`,
  ].join("\n");
  return { url, post };
}
