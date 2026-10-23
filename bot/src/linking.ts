import { randomInt } from "node:crypto";
import type { Data } from "./data/types";
import type { Mailer } from "./mailer";
import { hashCode, type LocalState } from "./state";

// Linking a WhatsApp ID to a member, in a DM the member opened (the bot never
// DMs first). The email is the proof: a 6-digit code goes to that address and
// nothing is linked without it. The phone number only ever comes from WhatsApp
// itself: a typed number can't be checked, and phone numbers are used to match
// people, so a wrong one could tie someone to another member.

export const CODE_TTL_MS = 10 * 60_000;
export const CODES_PER_HOUR = 3;
const MAX_TRIES = 5;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type LinkingDeps = { data: Data; state: LocalState; mailer: Mailer; now: () => number };

/** True when a DM is part of the linking flow (and so gets an answer). */
export function isLinkingMessage(waId: string, text: string, state: LocalState) {
  return isStart(text) || state.flow(waId) !== null;
}

const isStart = (text: string) => /^(!\s*(list\s+)?)?link[.!]?$/i.test(text.trim());

/**
 * Handles one DM. `waId` is the chat's ID (the flow and code limits are keyed
 * on it); `allIds` are every ID WhatsApp gave for the sender, all linked at the end.
 * `phone` is the sender's number if WhatsApp shows it, else null.
 * Returns the reply, or null to stay silent.
 */
export async function handleLinking(waId: string, allIds: string[], text: string, deps: LinkingDeps, phone: string | null = null): Promise<string | null> {
  const { state } = deps;
  const t = text.trim();

  if (isStart(t)) {
    state.setFlow(waId, { step: "email" });
    return "Hi! Let's link your WhatsApp to The List. What email do you sign up for practice with?";
  }
  const flow = state.flow(waId);
  if (!flow) return null;
  if (/^(cancel|stop|quit)[.!]?$/i.test(t)) {
    state.clearFlow(waId);
    return "OK, stopped. Send `link` to start again.";
  }

  switch (flow.step) {
    case "email":
      return sendCode(waId, t, deps);

    case "code": {
      if (EMAIL.test(t)) return sendCode(waId, t, deps); // a different (or the same) email: new code
      const code = t.replace(/\s/g, "");
      if (!/^\d{6}$/.test(code)) return "Send the 6-digit code from the email. Wrong address? Send the right email instead.";
      if (deps.now() > flow.expiresAt) {
        state.setFlow(waId, { step: "email" });
        return "That code has expired. Send your email again for a new one.";
      }
      if (hashCode(waId, code) !== flow.codeHash) {
        if (flow.tries + 1 >= MAX_TRIES) {
          state.setFlow(waId, { step: "email" });
          return "That code didn't match, too many times. Send your email again for a new code.";
        }
        state.setFlow(waId, { ...flow, tries: flow.tries + 1 });
        return "That code didn't match. Check the latest email and try again.";
      }
      const member = await deps.data.memberByEmail(flow.email);
      if (member) {
        state.saveLink(allIds, { email: flow.email, name: member.name, phone: member.phone });
        state.clearFlow(waId);
        return `You're set, ${member.name.split(" ")[0]}! Go back to the group and use \`!in\` / \`!list\` there.`;
      }
      state.setFlow(waId, { step: "name", email: flow.email });
      return "Thanks, that's you. You're new to The List: what's your full name?";
    }

    case "name": {
      const name = t.replace(/\s+/g, " ");
      if (name.length < 2 || name.length > 80 || !/\p{L}/u.test(name)) return "Please send your full name.";
      state.saveLink(allIds, { email: flow.email, name, phone });
      state.clearFlow(waId);
      return `You're set, ${name.split(" ")[0]}! Go back to the group and use \`!in\` / \`!list\` there. You'll be added to the club's list when you first sign up.`;
    }

    default: // a flow saved by an older version (it used to ask for a phone number)
      state.clearFlow(waId);
      return "Something changed on my side. Send `link` to start again.";
  }
}

async function sendCode(waId: string, text: string, deps: LinkingDeps): Promise<string> {
  const email = text.trim().toLowerCase();
  if (!EMAIL.test(email)) return "That doesn't look like an email. What email do you sign up with?";
  const hourAgo = deps.now() - 3_600_000;
  if (deps.state.codesSentSince(waId, hourAgo) >= CODES_PER_HOUR) {
    return "I've sent 3 codes in the last hour. Wait a bit, then send your email again.";
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await deps.mailer.send({
    to: email,
    subject: `Your code for The List: ${code}`,
    text: `Your code to link WhatsApp to The List is ${code}\n\nSend it to the bot in WhatsApp. It expires in 10 minutes.\n\nDidn't ask for this? Ignore this email; nothing changes.`,
  });
  deps.state.recordCodeSent(waId);
  deps.state.setFlow(waId, { step: "code", email, codeHash: hashCode(waId, code), expiresAt: deps.now() + CODE_TTL_MS, tries: 0 });
  return `I emailed a 6-digit code to ${email}. Send it here. It expires in 10 minutes.`;
}
