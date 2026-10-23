import type { BoardMember, Data, Member } from "./data/types";
import type { LocalState } from "./state";

// Who is asking. See BRIEF.md, "Who is asking":
// 1. a WhatsApp ID already linked in local state;
// 2. a visible phone number matching members.phone (saved as a link);
// 3. otherwise unknown: they link by DM (linking.ts).

export type Asker = {
  email: string;
  name: string | null;
  phone: string | null;
  /** Null for a new member who linked but hasn't signed up yet. */
  member: Member | null;
  board: BoardMember | null;
};

export async function whoIs(ids: string[], phone: string | null, data: Data, state: LocalState): Promise<Asker | null> {
  const link = state.link(ids);
  if (link) return askerFor(link.email, data, { name: link.name, phone: link.phone });
  const member = phone ? await data.memberByPhone(phone) : null;
  // How often hidden numbers stop us recognizing people. No numbers in the log.
  const kind = ids.some((id) => id.endsWith("@lid")) ? "hidden ID" : "phone ID";
  console.log(`[${new Date().toISOString()}] New sender (${kind}): number ${phone ? "visible" : "NOT visible"}, ${member?.email ? "member matched" : "no member match"}.`);
  if (phone) {
    if (member?.email) {
      state.saveLink(ids, { email: member.email, name: member.name, phone: member.phone ?? phone });
      return { email: member.email, name: member.name, phone: member.phone ?? phone, member, board: await data.boardMember(member.email) };
    }
  }
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
