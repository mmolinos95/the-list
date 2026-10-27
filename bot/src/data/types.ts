import { splitList, stageOf, type Stage } from "../../../src/lib/stage";
import type { EventList, EventRow, Spot, TeamColor } from "../../../src/lib/types";

// What the bot reads and writes. Two implementations of `Data`, both in this
// folder: supabase.ts (production, supabase-js + secret key) and sql.ts (plain
// SQL, used by the tests against PGlite with the real migrations). Both fetch
// the same raw shape and go through `shapePractice`, so the logic is shared.

export type { Stage, Spot, TeamColor, EventRow, EventList };

export type SignupRow = {
  id: string;
  member_id: string;
  spot: Spot;
  status: "active" | "dropped" | "removed";
  created_at: string;
  promoted_at: string | null;
  team: TeamColor | null;
  team_sent: TeamColor | null;
  name: string;
};

export type ListInfo = EventList & { main: SignupRow[]; waitlist: SignupRow[] };
export type Practice = { event: EventRow; lists: ListInfo[]; stage: Stage };

export type Member = { id: string; email: string | null; name: string; phone: string | null };
export type BoardMember = { id: string; email: string; name: string; role: "president" | "board" };

export type SignUpResult = {
  member_id: string;
  created: boolean;
  results: { list_id: string; list: string; spot: Spot; position: number; cap: number; already: boolean }[];
};
export type DropResult = { dropped: { list: string; spot: Spot; late: boolean }[]; locked: boolean };

export type EmailRow = {
  id: string;
  kind: string;
  to_address: string;
  member_id: string | null;
  event_id: string | null;
  payload: Record<string, unknown>;
};

export interface Data {
  /** Practices that haven't ended and start within `days`, soonest first. */
  upcoming(now: Date, days?: number): Promise<Practice[]>;
  practice(eventId: string, now: Date): Promise<Practice | null>;
  memberByEmail(email: string): Promise<Member | null>;
  /** The member with this phone: the most recently updated one with an email, else without. */
  memberByPhone(phone: string): Promise<Member | null>;
  membersById(ids: string[]): Promise<Member[]>;
  boardMember(email: string): Promise<BoardMember | null>;

  signUp(eventId: string, listIds: string[], name: string, email: string, phone: string | null): Promise<SignUpResult>;
  /** sign_up_by_phone: the member is whoever has this (WhatsApp-verified) phone, or a new one named `name`. */
  signUpByPhone(eventId: string, listIds: string[], name: string | null, phone: string): Promise<SignUpResult>;
  drop(eventId: string, memberId: string, listIds: string[]): Promise<DropResult>;
  openEvent(eventId: string): Promise<void>;
  cancelEvent(eventId: string, reason: string, by: string): Promise<number>;
  addSignup(listId: string, name: string, spot: Spot, by: string): Promise<{ signup_id: string; spot: Spot }>;
  shuffleTeams(eventId: string): Promise<void>;
  /** Deletes a member; their sign-ups and queued emails go with them (on delete cascade). */
  deleteMember(memberId: string): Promise<void>;

  // Emails a bot write queued (see quiet.ts). Every row a database function
  // writes in one call carries that call's now(), so these timestamps pick out
  // exactly the emails the bot's own call queued, never the app's.

  /** members.last_signup_at: set by sign_up and sign_up_by_phone. */
  lastSignupAt(memberId: string): Promise<string | null>;
  /** The latest dropped_at of this member's spots in this practice: set by drop_signups. */
  lastDroppedAt(eventId: string, memberId: string): Promise<string | null>;
  /** events.cancelled_at: set by cancel_event. */
  cancelledAt(eventId: string): Promise<string | null>;
  /** created_at of the member a walk-in sign-up made: set by add_signup. */
  addedAt(signupId: string): Promise<string | null>;
  /**
   * Deletes the not-yet-sent emails of one kind that one call queued (same
   * event, created_at = that call's time) for these members, or for rows with
   * no member when memberIds is null (board emails). Returns what it deleted.
   */
  takeEmails(q: { eventId: string; kind: string; at: string; memberIds: string[] | null }): Promise<EmailRow[]>;
}

type RawSignup = Omit<SignupRow, "name"> & { members: { name: string } | null };
export type RawEvent = EventRow & { event_lists: (EventList & { signups: RawSignup[] })[] };

/** supabase-js select for RawEvent; sql.ts builds the same shape with jsonb. */
export const PRACTICE_SELECT =
  "id, template_id, title, location, slug, starts_at, ends_at, opens_at, locks_at, edited_at, cancelled_at, cancel_reason, " +
  "event_lists(id, event_id, name, cap, makes_teams, position, starts_at, ends_at, teams_sent_at, " +
  "signups(id, member_id, spot, status, created_at, promoted_at, team, team_sent, members(name)))";

export function shapePractice(raw: RawEvent, now: Date): Practice {
  const { event_lists, ...event } = raw;
  const lists = [...event_lists]
    .sort((a, b) => a.position - b.position || a.starts_at.localeCompare(b.starts_at))
    .map(({ signups, ...list }) => {
      const rows = signups.map(({ members, ...s }) => ({ ...s, name: members?.name ?? "" }));
      return { ...list, ...splitList(rows) };
    });
  return { event, lists, stage: stageOf(event, lists, now) };
}
