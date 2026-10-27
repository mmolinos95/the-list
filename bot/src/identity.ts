import type { BoardMember, Data, Member } from "./data/types";
import type { LocalState } from "./state";

// Who is asking. See BRIEF.md, "Who is asking":
// 1. a WhatsApp ID already linked to an email in local state (linked by DM);
// 2. a phone number WhatsApp shows (it's verified), matching members.phone,
//    with or without an email (saved as a link, for @mentions);
// 3. otherwise unknown: their first `!in First Last` signs them up by phone.

export type Asker = {
  /** Null for members known only by their WhatsApp phone. */
  email: string | null;
  name: string | null;
  phone: string | null;
  /** Null for a new member who linked but hasn't signed up yet. */
  member: Member | null;
  board: BoardMember | null;
};

export async function whoIs(ids: string[], phone: string | null, data: Data, state: LocalState): Promise<Asker | null> {
  const link = state.link(ids);
  if (link?.email) return askerFor(link.email, data, { name: link.name, phone: link.phone });
  const byPhone = phone ?? link?.phone ?? null;
  const member = byPhone ? await data.memberByPhone(byPhone) : null;
  if (!link) {
    // How often hidden numbers stop us recognizing people. No numbers in the log.
    const kind = ids.some((id) => id.endsWith("@lid")) ? "hidden ID" : "phone ID";
    console.log(`[${new Date().toISOString()}] New sender (${kind}): number ${phone ? "visible" : "NOT visible"}, ${member ? "member matched" : "no member match"}.`);
  }
  if (member) {
    const known = { email: member.email, name: member.name, phone: member.phone ?? byPhone };
    if (!link || link.name !== member.name) state.saveLink(ids, known);
    return { ...known, member, board: member.email ? await data.boardMember(member.email) : null };
  }
  // Known by phone before, but the 12-month cleanup removed the member: same name again.
  if (link) return { email: null, name: link.name, phone: link.phone, member: null, board: null };
  return null;
}

/** The asker for an email: the member row if there is one, else what was saved when linking. */
export async function askerFor(email: string, data: Data, saved: { name: string | null; phone: string | null } = { name: null, phone: null }): Promise<Asker> {
  const [member, board] = await Promise.all([data.memberByEmail(email), data.boardMember(email)]);
  return {
    email,
    name: member?.name ?? saved.name,
    phone: member?.phone ?? saved.phone,
    member,
    board,
  };
}
