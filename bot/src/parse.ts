import { parseSelector, splitSelector } from "./pick";

// Turning a message into a command. Only messages that start with "!list"
// (any case) or @mention the bot get this far; see triggerBody().

export type Command =
  | { kind: "overview" }
  | { kind: "help" }
  | { kind: "details"; practice: string }
  | { kind: "me" }
  | { kind: "post"; practice: string }
  | { kind: "in"; practice: string; lists: string }
  | { kind: "out"; practice: string; lists: string; confirm: boolean }
  | { kind: "open"; practice: string }
  | { kind: "lock"; practice: string }
  | { kind: "cancel"; practice: string; reason: string; confirm: boolean }
  | { kind: "add"; practice: string; rest: string }
  | { kind: "teams"; practice: string }
  | { kind: "free"; text: string };

const KEYWORDS: Record<string, Command["kind"]> = {
  help: "help",
  me: "me",
  my: "me",
  mine: "me",
  status: "me",
  post: "post",
  in: "in",
  join: "in",
  signup: "in",
  out: "out",
  drop: "out",
  open: "open",
  lock: "lock",
  cancel: "cancel",
  add: "add",
  teams: "teams",
  team: "teams",
};

/**
 * What follows the trigger, or null if the message isn't for the bot.
 * `mentionsBot` comes from WhatsApp; the adapter strips the @mention itself.
 */
export function triggerBody(text: string, mentionsBot: boolean): string | null {
  const t = text.trim();
  const m = t.match(/^!list(?=$|[\s:,])[\s:,]*/i);
  if (m) return t.slice(m[0].length).trim();
  if (mentionsBot) return t.replace(/^!list\b/i, "").trim();
  return null;
}

/** Splits off a trailing "yes" (confirmations). */
function confirmTail(text: string) {
  const m = text.match(/^(.*?)\s*\byes[.!]*$/i);
  return m ? { text: m[1].trim(), confirm: true } : { text: text.trim(), confirm: false };
}

export function parseCommand(body: string): Command {
  const text = body.trim();
  if (!text) return { kind: "overview" };
  if (parseSelector(text)) return { kind: "details", practice: text };

  const [first, ...restWords] = text.split(/\s+/);
  let kind = KEYWORDS[first.toLowerCase().replace(/[.!?:]+$/, "")];
  let rest = restWords.join(" ");
  if (!kind && /^sign$/i.test(first) && /^up\b/i.test(rest)) {
    kind = "in";
    rest = rest.replace(/^up\s*/i, "");
  }
  if (!kind) return { kind: "free", text };
  if (kind === "help" || kind === "me") return rest && !/^(please|pls)$/i.test(rest) ? { kind: "free", text } : { kind };

  // "!list in" with no practice still counts as the command; the handler asks which one.
  const split = splitSelector(rest);
  if (!split && rest) return { kind: "free", text };
  const practice = split?.selector ?? "";
  const after = split?.rest ?? "";
  switch (kind) {
    case "in":
      return { kind, practice, lists: after };
    case "out": {
      const c = confirmTail(after);
      return { kind, practice, lists: c.text, confirm: c.confirm };
    }
    case "cancel": {
      const c = confirmTail(after);
      return { kind, practice, reason: c.text, confirm: c.confirm };
    }
    case "add":
      return { kind, practice, rest: after };
    case "post":
    case "open":
    case "lock":
    case "teams":
      return after ? { kind: "free", text } : { kind, practice };
  }
  return { kind: "free", text };
}
